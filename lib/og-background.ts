import { OG_HEIGHT, OG_WIDTH } from "@/lib/og-text-overlay";

// ── Abstract OpenGraph backgrounds ─────────────────────────────
//
// The share card must contain nothing a social platform's adult-content
// classifier can act on. The site's story covers are explicit photographs,
// so they cannot be used here — not even blurred. A Gaussian blur is a
// low-pass filter: it preserves exactly the low-frequency structure
// (skin-tone gradients, body silhouettes) that such a classifier keys on,
// and the smooth flesh-coloured result is arguably a stronger adult prior
// than the original photo.
//
// So the card background is drawn entirely from code as an abstract
// branded composition: a dark gradient, a soft accent glow and two
// concentric rings. There is no photography, no figure and no silhouette,
// so there is nothing to detect.
//
// This module is deliberately free of `sharp` and `node:fs` — it returns
// an SVG buffer that the route hands to sharp for rasterisation.

export const OG_ACCENT = "#f5a524";
export const OG_BG_DARK = "#0e1116";
export const OG_BG_WARM = "#1a1410";

/**
 * The three kinds of content the site publishes.
 *
 * Each kind gets its own accent colour, so a card is identifiable at a
 * glance: amber for a story, blue for a video, rose for a picture. The
 * colour is applied to the accent rule under the brand line, the glow
 * in the background and the type badge in the corner, so the type
 * reads from the card even before the text is read.
 */
export type OgContentKind = "story" | "video" | "picture";

interface OgKindStyle {
  /** The accent colour for the card. */
  accent: string;
  /** The Bengali label drawn in the type badge. */
  label: string;
  /** The Latin label drawn in the type badge. */
  latin: string;
}

const KIND_STYLE: Record<OgContentKind, OgKindStyle> = {
  story: { accent: "#f5a524", label: "গল্প", latin: "STORY" },
  video: { accent: "#3b9dff", label: "ভিডিও", latin: "VIDEO" },
  picture: { accent: "#ff5c8a", label: "ছবি", latin: "PICTURE" },
};

/**
 * The base gradient each content kind is drawn on.
 *
 * A Twitter/X card is frequently rendered small, so the badge in the
 * corner is not always legible. Tinting the frame itself gives a second,
 * much larger signal: a story card is warm amber, a video card is cold
 * blue and a picture card is rose. The tints are dark enough that the
 * white overlay text keeps its contrast.
 */
interface OgKindTint {
  /** The top of the vertical base gradient. */
  dark: string;
  /** The bottom of the vertical base gradient. */
  warm: string;
}

const TINT_BY_ACCENT: Record<string, OgKindTint> = {
  // story — warm amber
  "#f5a524": { dark: "#171109", warm: "#241a08" },
  // video — cold blue
  "#3b9dff": { dark: "#0a1017", warm: "#0c1826" },
  // picture — rose
  "#ff5c8a": { dark: "#170d12", warm: "#25121b" },
};

/**
 * The accent colour and labels for a content kind.
 */
export function ogKindStyle(kind: OgContentKind): OgKindStyle {
  return KIND_STYLE[kind] ?? KIND_STYLE.story;
}


export interface OgBackgroundOptions {
  /**
   * Accent hue in degrees. Callers should stay inside the safe band
   * (20–45) so every card stays on-brand and warm — a saturated blue or
   * purple card reads as a different kind of content.
   */
  hue?: number;
  /**
   * Extra SVG markup drawn on top of the background (e.g. an age badge).
   */
  decor?: string;
  /**
   * An explicit accent colour, overriding `hue`.
   *
   * The content kinds each carry their own accent so a card is
   * identifiable by its colour alone — see `ogKindStyle`.
   */
  accent?: string;
}

/**
 * Deterministic accent hue derived from a stable string key.
 *
 * The same slug always yields the same hue, so a story's card looks
 * consistent across renders, while different stories are visually
 * distinguishable without any photography.
 */
export function hueFromKey(key: string, min = 20, max = 45): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  }
  const span = max - min + 1;
  return min + ((hash >>> 0) % span);
}

/**
 * Build the 1200×630 abstract background as an SVG buffer.
 *
 * Contains no photographic content, no human figure and no silhouette.
 */
export function createOgBackground(options: OgBackgroundOptions = {}): Buffer {
  const hue = Math.max(0, Math.min(359, Math.round(options.hue ?? 32)));
  const accent = options.accent || `hsl(${hue} 82% 58%)`;
  // The kind tint colours the whole frame, not just a badge — a Twitter
  // card is often shown small, so the type has to read from the card's
  // overall colour as well as from the badge in the corner.
  const tint = options.accent ? TINT_BY_ACCENT[options.accent] : null;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${tint ? tint.dark : OG_BG_DARK}"/>
      <stop offset="100%" stop-color="${tint ? tint.warm : OG_BG_WARM}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.82" cy="0.18" r="0.72">
      <stop offset="0%" stop-color="${accent}" stop-opacity="${tint ? 0.46 : 0.30}"/>
      <stop offset="60%" stop-color="${accent}" stop-opacity="${tint ? 0.18 : 0.10}"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${tint ? tint.dark : OG_BG_DARK}" stop-opacity="0.55"/>
      <stop offset="55%" stop-color="${tint ? tint.dark : OG_BG_DARK}" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="${tint ? tint.dark : OG_BG_DARK}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#base)"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <circle cx="1090" cy="120" r="190" fill="none" stroke="${accent}" stroke-opacity="${tint ? 0.24 : 0.14}" stroke-width="2"/>
  <circle cx="1090" cy="120" r="300" fill="none" stroke="${accent}" stroke-opacity="${tint ? 0.13 : 0.07}" stroke-width="2"/>
  <circle cx="1090" cy="120" r="420" fill="none" stroke="${accent}" stroke-opacity="${tint ? 0.06 : 0.035}" stroke-width="2"/>
  <rect width="100%" height="100%" fill="url(#fade)"/>
  ${options.decor || ""}
</svg>`;

  return Buffer.from(svg);
}

/**
 * A prominent type badge in the top-left corner of a card.
 *
 * The card has to say what kind of content it is *before* the reader
 * gets to the title — on Twitter and X the card is small and the title
 * is the first thing that gets truncated. The badge is therefore large,
 * filled with the kind's accent colour and drawn in both scripts, so a
 * story, a video and a picture gallery are told apart at a glance.
 *
 * It sits where the brand line would otherwise start, so the brand line
 * moves down; the caller draws the brand line after the badge.
 */
export function createTypeBadge(
  kind: OgContentKind,
  options: { x?: number; y?: number } = {},
): string {
  const style = ogKindStyle(kind);
  const x = options.x ?? 72;
  const y = options.y ?? 74;
  const width = 178;
  const height = 52;

  return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="${style.accent}" fill-opacity="0.28" stroke="${style.accent}" stroke-opacity="0.95" stroke-width="2.5"/>
    <circle cx="${x + 28}" cy="${y + height / 2}" r="7" fill="${style.accent}"/>
    <text x="${x + 48}" y="${y + height / 2 + 8}" fill="${style.accent}" font-family="sans-serif" font-size="25" font-weight="700" letter-spacing="2">${style.latin}</text>
  </g>`;
}

/**
 * A small "১৮+" chip for the top-right corner of a card.
 *
 * Social platforms classify depictions, not labels — an explicit age
 * marker is one of the strongest signals a site can send that its
 * content is intentionally age-gated, and mature publishers use one
 * universally. It is deliberately low-contrast and out of the title's
 * way.
 */
export function createAgeBadge(label = "১৮+"): string {
  const width = 74;
  const height = 36;
  const x = OG_WIDTH - width - 48;
  const y = 84;

  return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" fill="#ffffff" fill-opacity="0.10" stroke="#ffffff" stroke-opacity="0.28" stroke-width="1"/>
    <text x="${x + width / 2}" y="${y + height / 2 + 6}" text-anchor="middle" fill="#ffffff" fill-opacity="0.82" font-family="sans-serif" font-size="17" font-weight="600" letter-spacing="1">${label}</text>
  </g>`;
}
