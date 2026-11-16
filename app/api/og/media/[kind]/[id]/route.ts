import { NextResponse } from "next/server";
import sharp from "sharp";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSiteConfig } from "@/lib/config";
import { getPublishedPicture } from "@/lib/pictures";
import { createOgTextOverlay, OG_FONT } from "@/lib/og-text-overlay";
import {
  createAgeBadge,
  createTypeBadge,
  hueFromKey,
  ogKindStyle,
} from "@/lib/og-background";
import { renderBlurredCoverBackground, ogBlurOverrideFromUrl } from "@/lib/og-cover-background";
import { sanitizeForSocial, sanitizeTitleForSocial } from "@/lib/social-text";
import { getCachedOg, setCachedOg } from "@/lib/og-cache";
import { OG_CACHE_HEADERS } from "@/lib/og-cache-headers";
import { mediaOgVersion, type OgMediaKind } from "@/lib/og-urls";
import { wrapTitle } from "@/lib/og-title-layout";

// ── Social-share preview for videos and picture galleries ─────
//
// A video or a gallery used to share the generic homepage card —
// every one of them looked identical, and the media's own cover was
// nowhere on the card.
//
// The cover is now part of the card, but only as blurred texture: see
// `lib/og-cover-background.ts` for why the raw cover cannot go into
// `og:image` directly. The text on top is drawn with the same layout
// as the story cards (`/api/og/post/[identifier]`), so a video and a
// story look like they came from the same site.
//
// Output is a single 1200×630 progressive JPEG.

const ACCENT = "#f5a524";

export const runtime = "nodejs";
export const revalidate = 86400;

interface RouteContext {
  // Next.js 15+ delivers dynamic route params as a promise.
  params: Promise<{ kind: string; id: string }>;
}

/** The resolved row, whichever kind it came from. */
interface MediaCard {
  id: string;
  title: string;
  /** The byline shown under the title — an uploader or a model name. */
  byline: string;
  /** The category line shown under the byline. */
  category: string;
  /** The remote cover image, if there is one. */
  coverUrl: string | null;
  updatedAt: string | null;
}

interface VideoRow {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  uploader_name: string | null;
  published_at: string | null;
  updated_at: string | null;
}

async function resolveVideo(id: string): Promise<MediaCard | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("video_posts")
    .select(
      "id, title, description, thumbnail_url, uploader_name, published_at, updated_at",
    )
    .eq("id", id)
    .eq("status", "published")
    .not("embed_url", "is", null)
    .lte("published_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.error("[og/media] video query failed:", error);
    return null;
  }

  const video = (data as VideoRow | null) || null;
  if (!video) return null;

  return {
    id: video.id,
    title: video.title,
    byline: video.uploader_name || "",
    category: "ভিডিও",
    coverUrl: video.thumbnail_url,
    updatedAt: video.updated_at || video.published_at,
  };
}

async function resolvePicture(id: string): Promise<MediaCard | null> {
  const picture = await getPublishedPicture(id);
  if (!picture) return null;

  return {
    id: picture.id,
    title: picture.title,
    byline: picture.model_name || picture.channel_name || "",
    category: picture.categories?.[0] || "ছবি",
    coverUrl: picture.cover_url,
    updatedAt: picture.updated_at ?? null,
  };
}

async function resolveMedia(
  kind: OgMediaKind,
  id: string,
): Promise<MediaCard | null> {
  return kind === "video" ? resolveVideo(id) : resolvePicture(id);
}

/**
 * Lay the title out on the card.
 *
 * The title is scaled down until it fits the three-line title block,
 * and only as a last resort is it shortened with a trailing ellipsis —
 * a card with a trimmed title still shows the picture, which matters
 * more than showing every word of the headline.
 */
function layoutTitle(
  context: ReturnType<typeof createOgTextOverlay>["context"],
  title: string,
): { lines: string[]; fontSize: number } {
  const titleTop = 218;
  const titleHeight = 210;

  let titleLines: string[] | null = null;
  let titleFontSize = 76;
  for (; titleFontSize >= 48; titleFontSize -= 2) {
    context.font = `500 ${titleFontSize}px "${OG_FONT}"`;
    titleLines = wrapTitle(
      title,
      (line) => context.measureText(line).width,
      1056,
      3,
    );
    if (titleLines && titleLines.length * titleFontSize * 1.24 <= titleHeight) break;
    titleLines = null;
  }

  if (!titleLines) {
    const words = title.trim().split(/\s+/);
    while (words.length > 1 && !titleLines) {
      words.pop();
      const shortened = `${words.join(" ")}…`;
      context.font = `500 48px "${OG_FONT}"`;
      titleLines = wrapTitle(
        shortened,
        (line) => context.measureText(line).width,
        1056,
        3,
      );
    }
    titleFontSize = 48;
  }

  return { lines: titleLines || ["Untitled"], fontSize: titleFontSize };
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { kind, id } = await params;

  if (kind !== "video" && kind !== "picture") {
    return new NextResponse("Unknown media kind", { status: 404 });
  }
  const mediaId = (id || "").trim();
  if (!mediaId) {
    return new NextResponse("Missing id", { status: 400 });
  }

  let media: MediaCard | null = null;
  try {
    media = await resolveMedia(kind, mediaId);
  } catch (error) {
    console.error("[og/media] lookup failed:", error);
    media = null;
  }
  if (!media) {
    return new NextResponse("Not found", { status: 404 });
  }

  // The cache key carries the version fingerprint *and* the row's
  // updated_at, so a title change or a swapped cover produces new
  // bytes instead of the stale card.
  const cacheKey = `og:media:${kind}:${media.id}:${mediaOgVersion(
    kind,
    media.id,
    media.updatedAt,
  )}`;
  // A `?blur=` override renders a different image from the same media,
  // so it must not be served from — or written into — the shared cache.
  // An override request bypasses the cache entirely and writes nothing.
  const blurOverride = ogBlurOverrideFromUrl(_req.url);
  const cached = blurOverride == null ? getCachedOg(cacheKey) : null;
  if (cached) {
    return new NextResponse(
      new Blob([new Uint8Array(cached)], { type: "image/jpeg" }),
      {
        status: 200,
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": String(cached.length),
          ...OG_CACHE_HEADERS,
        },
      },
    );
  }

  const site = getSiteConfig() as any;
  const siteUrl = (site?.url || "chotikahini.vercel.app").replace(/\/$/, "");
  const siteName = (site?.title || "চটি কাহিনী").toString();

  // ── Background: the media's own cover, blurred, under a type badge ──
  //
  // The card carries the VIDEO or PICTURE type badge in the kind's own
  // accent colour, so a video, a picture gallery and a story are told
  // apart on the timeline at a glance.
  const style = ogKindStyle(kind);
  const bg: Buffer = await renderBlurredCoverBackground({
    coverUrl: media.coverUrl,
    hue: hueFromKey(media.id),
    accent: style.accent,
    decor: `${createTypeBadge(kind)}${createAgeBadge()}`,
    // `?blur=<sigma>` renders this one card at a different blur, so
    // the tuning can be judged without touching the code. Absent, the
    // tuned default applies.
    blurSigma: blurOverride,
  });

  // ── Text overlay ──
  //
  // The crawlers classify the card text as well as the card image, so
  // everything rendered here goes through the social sanitiser.
  const safeTitle = sanitizeTitleForSocial(media.title || "Untitled");
  const safeByline = sanitizeForSocial(media.byline || "");
  const safeCategory = sanitizeForSocial(media.category || "");

  const { canvas, context } = createOgTextOverlay();
  context.textAlign = "left";
  context.shadowColor = "rgba(0,0,0,0.45)";
  context.shadowBlur = 3;
  context.shadowOffsetY = 2;
  // The brand line sits below the type badge, so it starts further right
  // and further down than it would without the badge.
  context.fillStyle = style.accent;
  context.beginPath();
  context.arc(76, 166, 5, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(255,255,255,0.96)";
  context.font = `500 25px "${OG_FONT}"`;
  context.fillText(`${siteName}  ·  CHOTI KAHINI`, 92, 174);

  context.shadowColor = "transparent";
  context.fillStyle = style.accent;
  context.fillRect(72, 196, 54, 3);

  context.shadowColor = "rgba(0,0,0,0.45)";
  context.shadowBlur = 3;
  context.shadowOffsetY = 2;
  context.fillStyle = "#fff";

  const { lines: titleLines, fontSize: titleFontSize } = layoutTitle(
    context,
    safeTitle,
  );

  // The title block starts below the type badge and the brand line.
  const titleTop = 218;
  const titleHeight = 210;
  const titleLineHeight = titleFontSize * 1.24;
  const titleBlockHeight =
    titleFontSize + (titleLines.length - 1) * titleLineHeight;
  const firstBaseline =
    titleTop + (titleHeight - titleBlockHeight) / 2 + titleFontSize;
  titleLines.forEach((line, index) =>
    context.fillText(line, 72, firstBaseline + index * titleLineHeight),
  );

  if (safeByline) {
    context.fillStyle = "rgba(255,255,255,0.92)";
    context.font = `400 26px "${OG_FONT}"`;
    context.fillText(safeByline, 72, 472, 1056);
  }
  if (safeCategory) {
    context.fillStyle = "rgba(255,255,255,0.95)";
    context.font = `400 18px "${OG_FONT}"`;
    context.fillText(safeCategory, 72, 508, 1056);
  }

  context.shadowColor = "transparent";
  context.strokeStyle = "rgba(255,255,255,0.22)";
  context.beginPath();
  context.moveTo(72, 568);
  context.lineTo(1128, 568);
  context.stroke();
  context.fillStyle = ACCENT;
  context.beginPath();
  context.arc(78, 600, 4, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(255,255,255,0.86)";
  context.font = "600 18px sans-serif";
  context.fillText(siteUrl, 94, 606);
  context.font = `600 18px "${OG_FONT}"`;
  context.textAlign = "right";
  context.fillText(
    kind === "video" ? "VIDEO  ·  ভিডিও" : "PICTURES  ·  ছবি",
    1128,
    606,
  );
  const textOverlay = canvas.toBuffer("image/png");

  const composed: Buffer = await sharp(bg)
    .composite([{ input: textOverlay, top: 0, left: 0 }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  // Only the canonical card is cached. A `?blur=` override is a
  // throwaway preview and must never be written into the cache, or it
  // would be served to every later visitor of this media.
  if (blurOverride == null) setCachedOg(cacheKey, composed);

  return new NextResponse(
    new Blob([new Uint8Array(composed)], { type: "image/jpeg" }),
    {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(composed.length),
        ...OG_CACHE_HEADERS,
      },
    },
  );
}
