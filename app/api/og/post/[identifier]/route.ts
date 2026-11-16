import { NextResponse } from "next/server";
import sharp from "sharp";
import { getPostBySlugAsync } from "@/lib/posts";
import { getSiteConfig } from "@/lib/config";
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
import { postOgVersion } from "@/lib/og-urls";
import { wrapTitle } from "@/lib/og-title-layout";

// ── Per-post social-share preview ────────────────────────────────
//
// Resolves the story by slug (or uid) and composites a complete
// link-preview layout (title, author, category, brand mark, age badge)
// over the story's own cover, blurred and darkened.
//
// The raw cover never reaches the crawler. The previous version used
// the story's cover photo unmodified, which is explicit imagery — the
// platforms' adult-content classifiers suppressed the card and showed
// the title with no picture at all. The cover is now blurred heavily
// and laid under a dark scrim, so it reads as the story's own artwork
// behind the title without exposing the image itself.
//
// Output is a single 1200×630 progressive JPEG.

export const runtime = "nodejs";
export const revalidate = 86400;


interface RouteContext {
  // Next.js 15+ delivers dynamic route params as a promise.
  params: Promise<{ identifier: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { identifier } = await params;
  const slug = (identifier || "").trim();
  if (!slug) {
    return new NextResponse("Missing identifier", { status: 400 });
  }

  let post: Awaited<ReturnType<typeof getPostBySlugAsync>> = null;
  try {
    post = await getPostBySlugAsync(slug);
  } catch (e) {
    post = null;
  }
  if (!post) {
    return new NextResponse("Story not found", { status: 404 });
  }

  const isPublished =
    post.status === "published" && new Date(post.publishedAt).getTime() <= Date.now();
  if (!isPublished) {
    return new NextResponse("Story not found", { status: 404 });
  }

  // Cache key is scoped to the resolved story slug AND the version
  // fingerprint, so a title change — or a change to the card renderer
  // itself — is picked up as a new key rather than serving stale bytes.
  // The previous key ignored the `?v=` query parameter entirely, so a new
  // URL still served the old card from the in-process cache.
  const ogCacheKey = `og:post:${post.slug}:${postOgVersion(post)}`;
  // A `?blur=` override renders a different image from the same story,
  // so it must not be served from — or written into — the shared cache.
  // An override request bypasses the cache entirely and writes nothing.
  const blurOverride = ogBlurOverrideFromUrl(_req.url);
  const cached = blurOverride == null ? getCachedOg(ogCacheKey) : null;
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

  const site = getSiteConfig() as any;
  const siteUrl = (site?.url || "chotikahini.vercel.app").replace(/\/$/, "");
  const siteName = (site?.title || "চটি কাহিনী").toString();

  // ── Build the background (the story's own cover, blurred) ──
  //
  // The story's own cover is used as the background, blurred and
  // darkened. The raw cover never reaches the crawler: it is explicit
  // imagery, and handing it over unmodified is what got the cards
  // suppressed by the platforms' adult-content classifiers. Blurring it
  // and laying a dark scrim over it turns it into texture — the
  // picture reads as the story's own artwork behind the title.
  //
  // The card carries the STORY type badge and the story accent colour,
  // so a story, a video and a picture gallery are told apart on the
  // timeline at a glance.
  const style = ogKindStyle("story");
  const bg: Buffer = await renderBlurredCoverBackground({
    coverUrl: post.cover,
    hue: hueFromKey(post.slug),
    accent: style.accent,
    decor: `${createTypeBadge("story")}${createAgeBadge()}`,
    // `?blur=<sigma>` renders this one card at a different blur, so
    // the tuning can be judged without touching the code. Absent, the
    // tuned default applies.
    blurSigma: blurOverride,
  });

  // ── Compose the text overlay ──
  //
  // The title and category are rendered into the card image, so they go
  // through the social sanitiser — the crawlers classify the card text
  // as well as the card image.
  const readingTime = post.readingTime || "";
  const safeTitle = sanitizeTitleForSocial(post.title || "Untitled");
  const safeCategory = sanitizeForSocial(
    post.categoryName || post.categoryId || "গল্প",
  );
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
  // The title block starts below the type badge and the brand line, so
  // it sits lower than it did before the badge was added.
  const titleTop = 218;
  const titleHeight = 210;
  let titleLines: string[] | null = null;
  let titleFontSize = 76;
  for (; titleFontSize >= 48; titleFontSize -= 2) {
    context.font = `500 ${titleFontSize}px "${OG_FONT}"`;
    titleLines = wrapTitle(safeTitle, (line) => context.measureText(line).width, 1056, 3);
    if (titleLines && titleLines.length * titleFontSize * 1.24 <= titleHeight) break;
    titleLines = null;
  }
  if (!titleLines) {
    const words = safeTitle.trim().split(/\s+/);
    while (words.length > 1 && !titleLines) {
      words.pop();
      const shortened = `${words.join(" ")}…`;
      context.font = `500 48px "${OG_FONT}"`;
      titleLines = wrapTitle(shortened, (line) => context.measureText(line).width, 1056, 3);
    }
    titleFontSize = 48;
  }
  titleLines = titleLines || ["Untitled"];
  context.font = `500 ${titleFontSize}px "${OG_FONT}"`;
  const titleLineHeight = titleFontSize * 1.24;
  const titleBlockHeight = titleFontSize + (titleLines.length - 1) * titleLineHeight;
  const firstBaseline = titleTop + (titleHeight - titleBlockHeight) / 2 + titleFontSize;
  titleLines.forEach((line, index) =>
    context.fillText(line, 72, firstBaseline + index * titleLineHeight),
  );
  context.fillStyle = "rgba(255,255,255,0.92)";
  context.font = `400 26px "${OG_FONT}"`;
  context.fillText(post.authorName || "অজ্ঞাত লেখক", 72, 472, 1056);
  context.fillStyle = "rgba(255,255,255,0.95)";
  context.font = `400 18px "${OG_FONT}"`;
  context.fillText(
    `${safeCategory}${readingTime ? `  ·  ${readingTime}` : ""}`,
    72,
    508,
    1056,
  );

  context.shadowColor = "transparent";
  context.strokeStyle = "rgba(255,255,255,0.22)";
  context.beginPath();
  context.moveTo(72, 568);
  context.lineTo(1128, 568);
  context.stroke();
  context.fillStyle = style.accent;
  context.beginPath();
  context.arc(78, 600, 4, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(255,255,255,0.86)";
  context.font = '600 18px sans-serif';
  context.fillText(siteUrl, 94, 606);
  context.font = `600 18px "${OG_FONT}"`;
  context.textAlign = "right";
  context.fillText("SHORT STORIES  ·  গল্প", 1128, 606);
  const textOverlay = canvas.toBuffer("image/png");

  const composed: Buffer = await sharp(bg)
    .composite([{ input: textOverlay, top: 0, left: 0 }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  // Only the canonical card is cached. A `?blur=` override is a
  // throwaway preview and must never be written into the cache, or it
  // would be served to every later visitor of this story.
  if (blurOverride == null) setCachedOg(ogCacheKey, composed);

  return new NextResponse(new Blob([new Uint8Array(composed)], { type: "image/jpeg" }), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(composed.length),
      ...OG_CACHE_HEADERS,
    },
  });
}
