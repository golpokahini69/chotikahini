import { NextResponse } from "next/server";
import sharp from "sharp";
import { getSiteConfig } from "@/lib/config";
import type { SiteConfig } from "@/lib/config";
import { createOgTextOverlay, OG_FONT, OG_HEIGHT, OG_WIDTH } from "@/lib/og-text-overlay";
import { createOgBackground, OG_ACCENT } from "@/lib/og-background";
import { sanitizeForSocial } from "@/lib/social-text";
import { getCachedOg, setCachedOg } from "@/lib/og-cache";
import { OG_IMAGE_VERSION, siteOgVersion } from "@/lib/og-urls";
import { OG_CACHE_HEADERS } from "@/lib/og-cache-headers";

// ── Social-share preview for the homepage ─────────────────────
//
// The background is an abstract branded composition generated in code
// (lib/og-background.ts) — no photography. The previous version used a
// story cover photo as the background, which put explicit imagery in
// every shared homepage card and got the card suppressed by the social
// platforms' adult-content classifiers.
const ACCENT = OG_ACCENT;

export const runtime = "nodejs";
export const revalidate = 86400;

/**
 * The homepage OG card is rendered from the site config alone, so the
 * output is identical for every request. It is cached in-process (see
 * lib/og-cache.ts) and at the CDN edge so the sharp/canvas pipeline does
 * not re-run on every crawler hit.
 *
 * The cache key carries the version fingerprint so that a change to the
 * card renderer (or to the site config) produces a new key instead of
 * serving stale bytes.
 */
const OG_HOME_CACHE_KEY = "og:home";

/**
 * The in-process cache key for the rendered homepage card.
 *
 * It carries the version fingerprint so a change to the renderer or to
 * the site config yields a new key instead of stale bytes. The previous
 * version ignored the `?v=` query parameter entirely, so a new URL still
 * served the old card from the in-process cache.
 */
function ogHomeCacheKey(site: SiteConfig): string {
  return `${OG_HOME_CACHE_KEY}:${siteOgVersion(site)}`;
}

export async function GET() {
  const site = getSiteConfig() as any;
  const cacheKey = ogHomeCacheKey(site);

  const cached = getCachedOg(cacheKey);
  if (cached) {
    return new NextResponse(new Blob([new Uint8Array(cached)], { type: "image/jpeg" }), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(cached.length),
        ...OG_CACHE_HEADERS,
      },
    });
  }

  const title = (site?.title || "Chotikahini").toString();
  // The tagline is rendered into the card image, so it goes through the
  // social sanitiser — the crawlers classify the card text as well as
  // the card image.
  const tagline = sanitizeForSocial(
    (site?.tagline || "ছোট গল্পের বড় দুনিয়া").toString(),
  );
  const url = (site?.url || "chotikahini.vercel.app").toString();

  // Abstract branded background — gradient, accent glow and concentric
  // rings. No photography, no figure, nothing for a classifier to act on.
  const bg: Buffer = await sharp(createOgBackground({ hue: 32 }))
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  const { canvas, context } = createOgTextOverlay();
  context.shadowColor = "rgba(0,0,0,0.38)";
  context.shadowBlur = 3;
  context.shadowOffsetY = 2;

  context.fillStyle = ACCENT;
  context.beginPath();
  context.arc(76, 98, 5, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(255,255,255,0.96)";
  context.font = `500 25px "${OG_FONT}"`;
  context.fillText("চটি কাহিনী  ·  CHOTI KAHINI", 92, 106);

  context.shadowColor = "transparent";
  context.fillStyle = ACCENT;
  context.fillRect(72, 194, 54, 3);

  context.shadowColor = "rgba(0,0,0,0.38)";
  context.shadowBlur = 3;
  context.shadowOffsetY = 2;
  context.fillStyle = "#fff";
  context.font = `500 88px "${OG_FONT}"`;
  context.fillText(title, 72, 320, 1056);
  context.fillStyle = "rgba(255,255,255,0.92)";
  context.font = `400 32px "${OG_FONT}"`;
  context.fillText(tagline, 72, 378, 1056);

  context.shadowColor = "transparent";
  context.strokeStyle = "rgba(255,255,255,0.22)";
  context.beginPath();
  context.moveTo(72, 496);
  context.lineTo(1128, 496);
  context.stroke();
  context.fillStyle = ACCENT;
  context.beginPath();
  context.arc(78, 542, 4, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(255,255,255,0.86)";
  context.font = '600 18px sans-serif';
  context.fillText(url, 94, 548);
  context.fillStyle = "rgba(255,255,255,0.78)";
  context.font = `500 18px "${OG_FONT}"`;
  context.textAlign = "right";
  context.fillText("SHORT STORIES  ·  গল্প", 1128, 548);
  const textOverlay = canvas.toBuffer("image/png");

  const composed: Buffer = await sharp(bg)
    .composite([{ input: textOverlay, top: 0, left: 0 }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  setCachedOg(cacheKey, composed);

  return new NextResponse(new Blob([new Uint8Array(composed)], { type: "image/jpeg" }), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(composed.length),
      ...OG_CACHE_HEADERS,
    },
  });
}
