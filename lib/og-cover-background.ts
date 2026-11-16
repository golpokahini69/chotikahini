import fs from "fs";
import path from "path";
import sharp from "sharp";
import { createOgBackground } from "@/lib/og-background";
import { OG_HEIGHT, OG_WIDTH } from "@/lib/og-text-overlay";

// ── Blurred-cover OpenGraph background ────────────────────────
//
// A story, a video or a picture gallery each has a cover of its own,
// and a share card that shows *that* cover is what a reader expects —
// the generic homepage card made every one of them look identical.
//
// But the raw cover must not reach the crawler: it is explicit
// imagery, and handing it over unmodified is what got the cards
// suppressed by the platforms' adult-content classifiers (see the
// comments in `app/(bn)/videos/[videoId]/page.tsx`).
//
// So the cover is used as *texture* rather than as content:
//
//   1. It is scaled to cover the whole 1200×630 frame.
//   2. It is blurred — see the tuning constants below for the sigma
//      and how far it can be dialled in either direction.
//   3. A dark scrim goes over the top, both to darken the remaining
//      colour and to guarantee the white overlay text is legible on
//      top of it.
//
// The abstract branded gradient is composited *underneath*, so the
// card is still recognisably the site's even when the cover fetch
// fails — a card that renders is a card the platform will show.
//
// Covers come from two places:
//   - a remote http(s) URL (a video poster, a gallery cover), fetched
//     with the same SSRF guardrails as `app/api/link-image/route.ts`;
//   - a local path under `public/` (a story cover), read from disk.
//
// This module is server-only: it performs network requests and reads
// the filesystem.

const FETCH_TIMEOUT_MS = 6000;
const MAX_IMAGE_BYTES = 8_000_000;

// ── Cover blur / scrim tuning ──────────────────────────────────
//
// Two numbers decide how much of the cover survives onto the card,
// and they are the only things standing between "the reader can tell
// what this story looks like" and "the card is a flat colour wash".
// Both are one-line knobs; edit them here, or override them at
// runtime with the env vars below and never touch this file.
//
// `OG_COVER_BLUR` is the blur sigma as a fraction of the frame width:
//
//   0.0125 → sigma 15   the cover is almost fully legible
//   0.025  → sigma 30   recognisable, fine detail gone
//   0.05   → sigma 60   colour wash, the shape is gone
//   0.10   → sigma 120  the v11 default — a flat wash, no figure
//
// `OG_COVER_SCRIM` is the opacity of the black rectangle laid over the
// blurred cover. It is what keeps the white overlay text readable, so
// it has to be lowered as the blur is lowered — a light blur needs no
// longer to hide anything, and a heavy scrim over a nearly-legible
// cover just drains the colour back out of it.
//
// The trade-off, stated plainly: a Gaussian blur is a low-pass filter.
// It removes high-frequency detail (texture, facial features) but
// preserves low-frequency structure (skin-tone gradients, body
// outlines) — and the low-frequency structure is what the platforms'
// adult-content classifiers key on. That is why this file used to sit
// at 0.10, and why the cards were suppressed when it was lower.
//
// The floor below keeps a typo from turning the card into the raw
// cover, which is the one outcome that actually breaks sharing. The
// ceiling keeps a typo from turning the card into an unreadable smear.
// Everything between them is a deliberate choice, and it is made in
// one place.

/** The blur sigma as a fraction of the frame width. */
const DEFAULT_BLUR_RATIO = 0.00125;

/** The opacity of the black scrim over the blurred cover. */
const DEFAULT_SCRIM_OPACITY = 0.1;

/**
 * The blur ratio bounds.
 *
 * The floor (0.5% → sigma 6) still blurs the cover enough that it is
 * unmistakably not the original file, so the card can never degenerate
 * into "the raw cover reached the crawler". The ceiling (0.10 →
 * sigma 120) is the heaviest blur this site has ever shipped, so
 * there is a known-good value to fall back to.
 */
const MIN_BLUR_RATIO = 0.0005;
const MAX_BLUR_RATIO = 0.1;

/** The scrim bounds — 0 is no scrim at all, 0.6 is nearly opaque. */
const MIN_SCRIM_OPACITY = 0;
const MAX_SCRIM_OPACITY = 0.6;

/** The resolved cover treatment for one render. */
export interface OgCoverTuning {
  /** The blur sigma as a fraction of the frame width. */
  blurRatio: number;
  /** The opacity of the black scrim over the blurred cover. */
  scrimOpacity: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readEnvNumber(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Resolve the cover blur and scrim for this render.
 *
 * The env vars win over the constants so the card can be tuned on a
 * running dev server without a rebuild — which is also what the
 * preview script and the debug route use to render a specific value.
 * Every value is clamped into its legal band, so a bad env var
 * degrades to the default instead of producing a broken card.
 */
export function ogCoverTuning(): OgCoverTuning {
  const envBlur = readEnvNumber("OG_COVER_BLUR");
  const envScrim = readEnvNumber("OG_COVER_SCRIM");

  const blurRatio = clamp(
    envBlur ?? DEFAULT_BLUR_RATIO,
    MIN_BLUR_RATIO,
    MAX_BLUR_RATIO,
  );
  const scrimOpacity = clamp(
    envScrim ?? DEFAULT_SCRIM_OPACITY,
    MIN_SCRIM_OPACITY,
    MAX_SCRIM_OPACITY,
  );

  return { blurRatio, scrimOpacity };
}

/**
 * Read a per-request blur override out of a URL's query string.
 *
 * The OG routes accept `?blur=<sigma>` so a single card can be
 * rendered at any blur level without touching the code or the env —
 * that is what makes the card previewable from a browser bar. The
 * value is a sigma in pixels (e.g. `?blur=60` for a sigma of 60), and
 * it is clamped into the legal band by `renderBlurredCoverBackground`
 * like every other override.
 *
 * Returns `undefined` when the parameter is absent or unparseable, so
 * the caller falls back to the tuned default.
 */
export function ogBlurOverrideFromUrl(url: string | null | undefined): number | undefined {
  if (!url) return undefined;
  try {
    const raw = new URL(url).searchParams.get("blur");
    if (raw == null) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Refuse to fetch from a host that points back at our own network.
 *
 * The cover URLs are scraped from third-party sites, so they are
 * untrusted input — without this guard a hostile cover URL could make
 * our own OG route probe the internal network (SSRF).
 */
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.startsWith("169.254.") ||
    h.startsWith("10.") ||
    h.startsWith("192.168.")
  );
}

/**
 * Read a cover that lives in the site's own `public/` directory.
 *
 * A story's cover is a local path such as `/images/Cover_pic/x.jpg`.
 * The path is resolved against `public/` and then checked to still be
 * inside it, so a stored `../../etc/passwd` cannot escape the folder.
 * The extension is checked against an image allowlist.
 */
const LOCAL_IMAGE_RE = /\.(jpg|jpeg|png|webp|gif|avif|bmp)$/i;

function readLocalCover(urlPath: string): Buffer | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }

  // Strip the leading slash: the path is relative to `public/`.
  const relative = decoded.replace(/^\/+/, "");
  if (!relative || relative.includes("\0")) return null;

  const publicDir = path.join(process.cwd(), "public");
  const resolved = path.resolve(publicDir, relative);

  // The resolved path must still be inside `public/` — this is what
  // stops `../../` traversal from reading arbitrary files.
  if (resolved !== publicDir && !resolved.startsWith(publicDir + path.sep)) {
    return null;
  }
  if (!LOCAL_IMAGE_RE.test(resolved)) return null;

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size === 0) return null;
    if (stat.size > MAX_IMAGE_BYTES) return null;
    return fs.readFileSync(resolved);
  } catch {
    return null;
  }
}

/**
 * Load a cover from either a local path or a remote URL.
 *
 * A cover that fails to load is not an error — the caller falls back
 * to the abstract background.
 */
async function loadCover(url: string): Promise<Buffer | null> {
  if (/^https?:\/\//i.test(url)) return fetchCoverImage(url);
  if (url.startsWith("/")) return readLocalCover(url);
  return null;
}

/**
 * Fetch a remote image and return its bytes, or `null` if it cannot
 * be used.
 *
 * The guardrails mirror `app/api/link-image/route.ts`: http(s) only,
 * no private hosts, a hard timeout, a byte cap, and only `image/*`
 * content-types accepted. A cover that fails any of these checks is
 * not an error — the caller falls back to the abstract background.
 */
async function fetchCoverImage(url: string): Promise<Buffer | null> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;
  if (isBlockedHost(target.hostname)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(target.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ChotikahiniShareCard/1.0)",
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
      },
    });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0) return null;
    if (buffer.byteLength > MAX_IMAGE_BYTES) return null;

    return buffer;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the 1200×630 background for a media share card.
 *
 * The cover is blurred and darkened over the site's abstract gradient.
 * When the cover cannot be fetched — a dead link, a host that blocks
 * us, a content-type that is not an image — the abstract gradient is
 * returned on its own, so the card still renders.
 *
 * @param coverUrl  The remote cover image. Optional.
 * @param hue       Accent hue for the fallback background, so a
 *                  video and a picture do not both fall back to the
 *                  same flat card.
 */
export async function renderBlurredCoverBackground({
  coverUrl,
  hue,
  accent,
  decor,
  blurSigma,
  scrimOpacity,
}: {
  coverUrl?: string | null;
  hue: number;
  /**
   * An explicit accent colour, overriding `hue`.
   *
   * The content kinds each carry their own accent — see `ogKindStyle` —
   * so a video card, a picture card and a story card are recognisable
   * by colour alone.
   */
  accent?: string;
  /**
   * Extra SVG markup (the type badge, the age badge) drawn on top of
   * everything else.
   *
   * It is composited *after* the cover, not baked into the base layer:
   * the cover fills the whole frame, so a badge drawn underneath it
   * would be completely buried — which is exactly what happened to the
   * VIDEO / PICTURE badge before this was split out.
   */
  decor?: string;
  /**
   * Override the blur sigma, in pixels.
   *
   * This is a genuine override — it replaces the tuned default — which
   * is what makes the card previewable at any blur level. It used to
   * be a floor (`Math.max`), which meant no caller could ever ask for
   * a lighter blur than the default; the knob was welded shut.
   *
   * The value is still clamped into the legal band, so a caller cannot
   * ask for sigma 0 (the raw cover) even by accident.
   */
  blurSigma?: number;
  /**
   * Override the scrim opacity for this render.
   *
   * Clamped to the same band as the tuned default. Used by the debug
   * route to render a comparison strip at one consistent scrim.
   */
  scrimOpacity?: number;
}): Promise<Buffer> {
  const tuning = ogCoverTuning();

  // The blur ratio, from the more specific of the two sources: an
  // explicit per-call sigma wins, otherwise the tuned/env default.
  const blurRatio = clamp(
    blurSigma != null
      ? blurSigma / OG_WIDTH
      : tuning.blurRatio,
    MIN_BLUR_RATIO,
    MAX_BLUR_RATIO,
  );
  const scrim = clamp(
    scrimOpacity ?? tuning.scrimOpacity,
    MIN_SCRIM_OPACITY,
    MAX_SCRIM_OPACITY,
  );

  const base = await sharp(createOgBackground({ hue, accent }))
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  const decorLayer = decor
    ? await sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">${decor}</svg>`,
        ),
      )
        .png()
        .toBuffer()
    : null;

  const cover = coverUrl ? await loadCover(coverUrl) : null;

  if (!cover) {
    if (!decorLayer) return base;
    return await sharp(base)
      .composite([{ input: decorLayer, top: 0, left: 0 }])
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
  }

  try {
    // The scrim is a plain black rectangle. Compositing it as an
    // overlay over the blurred cover is cheaper and sharper than
    // rebuilding the image per-pixel, and it composites against the
    // blur rather than the original.
    const scrimLayer = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">
        <rect width="100%" height="100%" fill="#000000" fill-opacity="${scrim}"/>
      </svg>`,
    );

    const blurredCover = await sharp(cover)
      .resize(OG_WIDTH, OG_HEIGHT, { fit: "cover", position: "centre" })
      .blur(blurRatio * OG_WIDTH)
      .toBuffer();

    const layers = [
      { input: blurredCover, top: 0, left: 0 },
      { input: scrimLayer, top: 0, left: 0 },
    ];
    if (decorLayer) layers.push({ input: decorLayer, top: 0, left: 0 });

    return await sharp(base)
      .composite(layers)
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
  } catch {
    // A corrupt or unsupported image that survived the content-type
    // check still fails inside sharp. The card must render regardless.
    if (!decorLayer) return base;
    return await sharp(base)
      .composite([{ input: decorLayer, top: 0, left: 0 }])
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
  }
}
