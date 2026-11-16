/**
 * lib/public-slug.ts
 *
 * Builds the human-readable public URL slug for a published item.
 *
 * A public slug is just the title, in English, in kebab-case:
 *
 *   dhaka-new-bridge          (story)
 *   jamal-nur-video           (video)
 *   kutir-chobi                (picture gallery)
 *
 * When two items share a title, the second one gets a numeric suffix:
 *
 *   dhaka-new-bridge
 *   dhaka-new-bridge-1
 *   dhaka-new-bridge-2
 *
 * The suffix is only added when it's actually needed, so the common case
 * stays perfectly clean.
 *
 * Two rules make the whole thing work:
 *
 *   1. The slug is written ONCE, when the item first becomes public. It is
 *      never regenerated when the title is edited afterwards, so a link
 *      that was shared never breaks.
 *
 *   2. The slug is unique *within its content type*. A story, a video and
 *      an image may all use "dhaka-new-bridge" at the same time, because
 *      they live under different URL prefixes (/golpo/, /video/, /image/).
 *
 * Bengali titles are translated to English first, so the slug reads as
 * English words ("dhaka-new-bridge") rather than Bengali characters.
 */

import { translateText } from "@/lib/translate";

/** The three kinds of public content that get their own URL prefix. */
export type PublicSlugKind = "story" | "video" | "picture";

/**
 * The URL segment that identifies each content type.
 *
 * These are also the route prefixes: /golpo/…, /video/…, /image/….
 */
export const PUBLIC_SLUG_PREFIX: Record<PublicSlugKind, string> = {
  story: "golpo",
  video: "video",
  picture: "image",
};

/**
 * Fallback slug base, used when a title can't produce any usable ASCII
 * words (an all-symbol title, or a translate outage).
 */
const FALLBACK_BASE: Record<PublicSlugKind, string> = {
  story: "golpo",
  video: "video",
  picture: "image",
};

/**
 * How many characters of the title to keep.
 *
 * Slugs are meant to be short and readable, so this is deliberately tight.
 */
const MAX_BASE_LENGTH = 60;

/** Bengali Unicode block — used to decide whether a title needs translating. */
const HAS_BENGALI = /[\u0980-\u09ff]/;

/**
 * Strip diacritics and reduce a string to lowercase ASCII kebab-case.
 *
 * "Dhaka's New Bridge!" → "dhaka-s-new-bridge"
 */
function toAsciiKebab(text: string): string {
  return text
    // Decompose so "é" becomes "e" + combining accent, then drop the accent.
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Recompose so the remaining characters are in NFC again.
    .normalize("NFC")
    .toLowerCase()
    // Anything that is not a letter or a digit becomes a dash.
    .replace(/[^a-z0-9]+/g, "-")
    // Collapse runs of dashes and trim the edges.
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Turn a title into the slug base — the readable part.
 *
 * Bengali titles are translated to English first. Titles that are already
 * Latin skip the translation entirely (one less network call, and no risk
 * of the translator mangling an English product name).
 *
 * Never returns an empty string: on failure it falls back to the content
 * type's keyword.
 */
export async function titleToSlugBase(
  title: string,
  kind: PublicSlugKind,
): Promise<string> {
  const cleanTitle = (title || "").trim();
  if (!cleanTitle) return FALLBACK_BASE[kind];

  let candidate = cleanTitle;

  if (HAS_BENGALI.test(cleanTitle)) {
    try {
      // Translate Bengali → English. A failure here is not fatal: the
      // title still has to produce *a* slug, so we fall through to the
      // ASCII pass below (which will yield nothing for pure Bengali) and
      // then to the keyword fallback.
      const translated = await translateText(cleanTitle, "en", "bn");
      if (translated && translated.trim()) candidate = translated;
    } catch (err) {
      console.error("[public-slug] translation failed:", err);
    }
  }

  const slug = toAsciiKebab(candidate);

  if (!slug) return FALLBACK_BASE[kind];

  if (slug.length <= MAX_BASE_LENGTH) return slug;

  // Cut at a word boundary so we don't end on a half word ("dhaka-new-bri").
  const clipped = slug.slice(0, MAX_BASE_LENGTH);
  const lastDash = clipped.lastIndexOf("-");
  const trimmed = lastDash > 20 ? clipped.slice(0, lastDash) : clipped;
  return trimmed.replace(/-+$/g, "") || FALLBACK_BASE[kind];
}

/**
 * Pick a slug that isn't taken yet.
 *
 * `isTaken` is asked about a candidate slug and answers whether that exact
 * string is already used *within this content type*. The first candidate
 * that isn't taken wins; if it is, we try `base-1`, `base-2`, and so on.
 *
 * The caller supplies `isTaken` because "is this slug taken?" is a
 * database question, and the three content tables live in different places
 * (and a story's slug table is `stories`, a video's is `video_posts`).
 *
 * `reserved` lists slugs that must never be handed out — the content
 * type's own route prefix, for instance. A video whose title is "Video"
 * would otherwise want `/video/video`, which is confusing enough to be
 * worth avoiding.
 */
export async function pickUniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
  reserved: string[] = [],
): Promise<string> {
  const isReserved = (candidate: string) =>
    reserved.includes(candidate.toLowerCase());

  if (!isReserved(base) && !(await isTaken(base))) return base;

  // Cap the search so a pathological run of identical titles can't spin
  // forever. 200 duplicates of one headline is far beyond realistic.
  for (let n = 1; n <= 200; n++) {
    const candidate = `${base}-${n}`;
    if (!isReserved(candidate) && !(await isTaken(candidate))) return candidate;
  }

  // Extremely unlikely — fall back to something that cannot collide
  // because it carries a random component.
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build the full public slug for an item.
 *
 * `isTaken` is the same callback `pickUniqueSlug` takes. See that
 * function for why the caller supplies it.
 */
export async function buildPublicSlug(
  title: string,
  kind: PublicSlugKind,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const base = await titleToSlugBase(title, kind);
  return pickUniqueSlug(
    base,
    isTaken,
    // A story titled "Golpo" would otherwise claim /golpo/golpo, and a
    // video titled "Video" would claim /video/video.
    [PUBLIC_SLUG_PREFIX[kind]],
  );
}

/**
 * Build the public path (no domain) for an item.
 *
 *   buildPublicPath("golpo", "dhaka-new-bridge")
 *     → "/golpo/dhaka-new-bridge"
 */
export function buildPublicPath(
  kind: PublicSlugKind,
  publicSlug: string,
): string {
  return `/${PUBLIC_SLUG_PREFIX[kind]}/${publicSlug}`;
}

/**
 * Build the absolute public URL for an item.
 */
export function buildPublicUrl(
  kind: PublicSlugKind,
  publicSlug: string,
  siteUrl: string,
): string {
  const base = siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
  return `${base}${buildPublicPath(kind, publicSlug)}`;
}
