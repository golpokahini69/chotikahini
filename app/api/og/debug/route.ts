import { NextResponse } from "next/server";
import sharp, { type OverlayOptions } from "sharp";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getPostBySlugAsync } from "@/lib/posts";
import { getPublishedPicture } from "@/lib/pictures";
import { createOgTextOverlay, OG_FONT } from "@/lib/og-text-overlay";
import { createTypeBadge, hueFromKey, ogKindStyle } from "@/lib/og-background";
import { renderBlurredCoverBackground } from "@/lib/og-cover-background";
import { wrapTitle } from "@/lib/og-title-layout";

// ── Cover blur comparison strip (development only) ──────────────
//
// The share card's background blur is a single number, and judging it
// by eye from the code is hopeless: the difference between sigma 15 and
// sigma 60 is obvious once the two are side by side and invisible when
// described in a comment.
//
// This route renders one card at several blur levels and lays the
// frames out in a labelled strip, so the tuning can be picked by
// looking at it rather than by guessing.
//
//   /api/og/debug?slug=<story-slug>
//   /api/og/debug?kind=video&id=<id>
//   /api/og/debug?kind=picture&id=<id>
//
// Optional:
//   ?blurs=0.0125,0.025,0.05   — the blur ratios to compare
//   ?scrim=0.22                 — the scrim opacity to render them at
//
// It renders through the same `renderBlurredCoverBackground` the real
// routes use, so what shows up here is what ships.
//
// Development only: the route 404s in production, so it cannot become
// a render-amplification vector on the live site.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The blur ratios compared when the request does not name any. */
const DEFAULT_RATIOS = [0.0125, 0.025, 0.05, 0.1];

/** The gap between two frames in the strip, in pixels. */
const GAP = 16;

/** How tall the label band under each frame is, in pixels. */
const LABEL_HEIGHT = 46;

/** The width of one frame in the strip — half the real card width. */
const FRAME_WIDTH = 600;

/** The cover URL and the card's identity, whichever kind was asked for. */
interface DebugSubject {
  coverUrl: string | null;
  kind: "story" | "video" | "picture";
  key: string;
  title: string;
}

async function resolveSubject(
  slug: string | null,
  kind: string | null,
  id: string | null,
): Promise<DebugSubject | null> {
  if (kind === "video" && id) {
    const { data } = await getSupabaseAdmin()
      .from("video_posts")
      .select("id, title, thumbnail_url")
      .eq("id", id)
      .maybeSingle();
    const video = data as
      | { id: string; title: string; thumbnail_url: string | null }
      | null;
    if (!video) return null;
    return {
      coverUrl: video.thumbnail_url,
      kind: "video",
      key: video.id,
      title: video.title || "",
    };
  }

  if (kind === "picture" && id) {
    const picture = await getPublishedPicture(id);
    if (!picture) return null;
    return {
      coverUrl: picture.cover_url,
      kind: "picture",
      key: picture.id,
      title: picture.title || "",
    };
  }

  if (slug) {
    const post = await getPostBySlugAsync(slug);
    if (!post) return null;
    return {
      coverUrl: post.cover,
      kind: "story",
      key: post.slug,
      title: post.title || "",
    };
  }

  return null;
}

export async function GET(req: Request) {
  // Never exposed on the live site.
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

  const params = new URL(req.url).searchParams;
  let subject: DebugSubject | null = null;
  try {
    subject = await resolveSubject(
      params.get("slug"),
      params.get("kind"),
      params.get("id"),
    );
  } catch (error) {
    console.error("[og/debug] subject lookup failed:", error);
    return new NextResponse("Subject lookup failed", { status: 500 });
  }
  if (!subject) {
    return new NextResponse(
      "Pass ?slug=<story-slug> or ?kind=video|picture&id=<id>",
      { status: 400 },
    );
  }

  // The blur ratios to compare. Clamped by the renderer, so a silly
  // value here degrades rather than exploding.
  const ratios = (params.get("blurs")
    ?.split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0) ?? DEFAULT_RATIOS
  ).slice(0, 6);

  const scrimParam = params.get("scrim");
  const scrim =
    scrimParam != null && Number.isFinite(Number(scrimParam))
      ? Number(scrimParam)
      : undefined;

  const style = ogKindStyle(subject.kind);
  const frameHeight = Math.round((FRAME_WIDTH * 630) / 1200);

  // Render the same card once per blur level. The text overlay is
  // drawn once and reused, so the only thing that differs between
  // frames is the blur — which is the entire point of the strip.
  const { canvas, context } = createOgTextOverlay();
  drawCardText(context, subject.title, style.accent);

  // The overlay is drawn at the card's full 1200×630 size and then
  // scaled down to the frame size, so the type in the strip is
  // proportionally identical to the type on the real card.
  const textOverlay = await sharp(canvas.toBuffer("image/png"))
    .resize(FRAME_WIDTH, frameHeight, { fit: "fill" })
    .toBuffer();

  const frames: OverlayOptions[] = [];
  const labels: string[] = [];

  try {
    for (const ratio of ratios) {
      const bg = await renderBlurredCoverBackground({
        coverUrl: subject.coverUrl,
        hue: hueFromKey(subject.key),
        accent: style.accent,
        decor: createTypeBadge(subject.kind),
        blurSigma: ratio * 1200,
        scrimOpacity: scrim,
      });

      // The frame carries the title, exactly as the real card does — so
      // the strip shows whether the white text stays readable over a
      // lighter blur, not just how the cover looks.
      const frame = await sharp(bg)
        .resize(FRAME_WIDTH, frameHeight, { fit: "fill" })
        .composite([{ input: textOverlay, top: 0, left: 0 }])
        .toBuffer();

      frames.push({ input: frame, top: 0, left: 0 });
      labels.push(`${(ratio * 100).toFixed(2)}%  ·  σ ${Math.round(ratio * 1200)}`);
    }
  } catch (error) {
    console.error("[og/debug] frame render failed:", error);
    return new NextResponse("Frame render failed", { status: 500 });
  }

  // The strip: frames side by side, each with its blur level under it.
  const stripWidth = frames.length * FRAME_WIDTH + (frames.length - 1) * GAP;
  const stripHeight = frameHeight + LABEL_HEIGHT;

  const labelSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${stripWidth}" height="${stripHeight}">
      <rect width="100%" height="100%" fill="#0b0d11"/>
      ${labels
        .map((label, index) => {
          const x = index * (FRAME_WIDTH + GAP);
          return `<text x="${x + FRAME_WIDTH / 2}" y="${
            frameHeight + LABEL_HEIGHT / 2 + 7
          }" text-anchor="middle" fill="#f5a524" font-family="sans-serif" font-size="22" font-weight="600">${label}</text>`;
        })
        .join("")}
    </svg>`,
  );

  const composed = await sharp(labelSvg)
    .composite(frames.map((overlay, index) => ({
      ...overlay,
      top: 0,
      left: index * (FRAME_WIDTH + GAP),
    })))
    .png()
    .toBuffer();

  return new NextResponse(new Blob([new Uint8Array(composed)], { type: "image/png" }), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(composed.length),
      // Never cached: this is a development tool whose whole purpose is
      // to show the current state of the tuning.
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Draw the card's text over a frame.
 *
 * Kept deliberately close to the real routes' layout so the strip
 * shows the same thing a reader would see — including whether the
 * white text stays readable over a lighter blur.
 */
function drawCardText(
  context: ReturnType<typeof createOgTextOverlay>["context"],
  title: string,
  accent: string,
): void {
  context.textAlign = "left";
  context.shadowColor = "rgba(0,0,0,0.45)";
  context.shadowBlur = 3;
  context.shadowOffsetY = 2;

  context.fillStyle = accent;
  context.beginPath();
  context.arc(76, 166, 5, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(255,255,255,0.96)";
  context.font = `500 25px "${OG_FONT}"`;
  context.fillText("চটি কাহিনী  ·  CHOTI KAHINI", 92, 174);

  context.shadowColor = "transparent";
  context.fillStyle = accent;
  context.fillRect(72, 196, 54, 3);

  context.shadowColor = "rgba(0,0,0,0.45)";
  context.shadowBlur = 3;
  context.shadowOffsetY = 2;
  context.fillStyle = "#fff";

  const titleTop = 218;
  const titleHeight = 210;
  let titleLines: string[] | null = null;
  let fontSize = 76;
  for (; fontSize >= 48; fontSize -= 2) {
    context.font = `500 ${fontSize}px "${OG_FONT}"`;
    titleLines = wrapTitle(
      title,
      (line) => context.measureText(line).width,
      1056,
      3,
    );
    if (titleLines && titleLines.length * fontSize * 1.24 <= titleHeight) break;
    titleLines = null;
  }
  if (!titleLines) {
    const words = title.trim().split(/\s+/);
    while (words.length > 1 && !titleLines) {
      words.pop();
      titleLines = wrapTitle(
        `${words.join(" ")}…`,
        (line) => context.measureText(line).width,
        1056,
        3,
      );
    }
    fontSize = 48;
  }
  const lines = titleLines || ["Untitled"];
  const lineHeight = fontSize * 1.24;
  const blockHeight = fontSize + (lines.length - 1) * lineHeight;
  const firstBaseline = titleTop + (titleHeight - blockHeight) / 2 + fontSize;
  lines.forEach((line, index) =>
    context.fillText(line, 72, firstBaseline + index * lineHeight),
  );
}
