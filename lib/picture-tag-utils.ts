/**
 * URL-safe slugs for picture-gallery tags.
 *
 * Picture tags are scraped from the provider (usually English words like
 * "Blonde", "MILF", "Cute"), and they can contain characters that have
 * no place in a path segment: "18+", "A/B", "Fetish & BDSM".
 *
 * A lossy slug would silently break those — "18+" has to become "18+",
 * not "18", or the filter would search for a tag nobody uses.
 *
 * So the slug is the tag itself, percent-encoded, with only the
 * characters that actually break a URL path replaced. The value is
 * decoded back exactly, so the tag that reaches the database filter is
 * byte-for-byte the tag that was stored.
 *
 *   "Blonde"        → "Blonde"
 *   "Hot Blonde"    → "Hot%20Blonde"
 *   "18+"           → "18%2B"
 *   "Fetish & BDSM" → "Fetish%20%26%20BDSM"
 *
 * The post section's `tagSlug` (base64) exists for a different reason —
 * Bengali tags break on some CDNs. Picture tags are Latin and are
 * percent-encoded instead, which keeps the URL readable.
 */

/**
 * Characters that must be escaped inside a URL path segment.
 *
 * Everything else — letters, digits, spaces, `-`, `_`, `.`, `~` — is
 * left as-is so the URL stays readable ("Hot%20Blonde" rather than
 * "Hot_Blonde_4b28b3").
 */
const PATH_UNSAFE = /[^A-Za-z0-9\-._~ ]/g;

/**
 * Turn a tag into a URL-safe slug.
 *
 * The result is safe to drop straight into a path segment.
 */
export function pictureTagSlug(tag: string): string {
  const normalized = tag.trim().normalize("NFC");
  if (!normalized) return "";

  // Escape the characters that would break the path, then percent-encode
  // what is left (notably the space). encodeURIComponent would also
  // escape `-`, `_`, `.` and `~`, which are all perfectly safe in a
  // path segment — so those are restored afterwards to keep the URL
  // readable.
  const escaped = normalized
    .replace(PATH_UNSAFE, (char) =>
      encodeURIComponent(char).replace(/%2B/g, "%2B"),
    )
    .replace(/ /g, "%20");

  return escaped;
}

/**
 * Turn a slug back into the original tag.
 *
 * `decodeURIComponent` restores the exact characters the slug escaped,
 * so the tag that reaches the filter is the one that was stored — no
 * casing is invented, no punctuation is dropped.
 *
 * A malformed slug (a stray `%` that isn't a valid escape) falls back to
 * the raw string rather than throwing, so a hand-edited URL renders a
 * "no results" page instead of a 500.
 */
export function pictureTagFromSlug(slug: string): string {
  if (!slug) return "";
  try {
    return decodeURIComponent(slug).normalize("NFC");
  } catch {
    return slug;
  }
}
