/**
 * Canonical form of a gallery's source URL, used to detect duplicates.
 *
 * The same gallery can be pasted in several different-looking ways:
 *
 *   https://www.pornpics.com/galleries/foo-10648923/
 *   https://www.pornpics.com/galleries/foo-10648923
 *   https://www.pornpics.com/galleries/foo-10648923/?utm_source=twitter
 *   https://WWW.PornPics.com/galleries/foo-10648923/
 *
 * All four are the same gallery. If we compared the raw strings, an admin
 * could publish the same gallery several times and the site would show the
 * same pictures under different cards.
 *
 * So the URL is reduced to a stable key before it is stored or compared:
 *
 *   • the scheme is dropped (http and https are the same page)
 *   • `www.` is dropped
 *   • the host is lower-cased
 *   • the query string and fragment are dropped (tracking params are noise)
 *   • a trailing slash is dropped
 *   • the path is lower-cased for the host part only — no, path segments
 *     are case-sensitive on most providers, so they are kept verbatim.
 *
 * The returned key is what the unique index is built on, so the database
 * refuses a second copy of the same gallery no matter how it was typed.
 */

/**
 * Reduce a source URL to its canonical duplicate-detection key.
 *
 * Returns an empty string for anything that isn't a usable absolute URL, so
 * the caller can reject it before it reaches the database.
 *
 * IMPORTANT: this must produce EXACTLY the same string as the SQL function
 * `public.picture_source_key` in scripts/picture-duplicates.sql — that
 * function backs the generated `source_key` column and the unique index.
 * If the two ever disagree, the route's pre-check would pass while the
 * database rejects the insert (or worse, the reverse).
 *
 * The shared format is: `<host-without-www>/<path-without-trailing-slash>`
 * e.g. `pornpics.com/galleries/foo-10648923`
 */
export function pictureSourceKey(sourceUrl: string): string {
  const raw = (sourceUrl || "").trim();
  if (!raw) return "";

  // Strip the scheme, then the query string, then the fragment — the same
  // order the SQL function uses.
  let rest = raw;
  const schemeEnd = rest.indexOf("://");
  if (schemeEnd !== -1) rest = rest.slice(schemeEnd + 3);

  const q = rest.indexOf("?");
  if (q !== -1) rest = rest.slice(0, q);
  const h = rest.indexOf("#");
  if (h !== -1) rest = rest.slice(0, h);

  // Split the host from the path.
  const slash = rest.indexOf("/");
  let host = slash === -1 ? rest : rest.slice(0, slash);
  let path = slash === -1 ? "" : rest.slice(slash + 1);

  // Lower-case the host FIRST, then drop a leading "www." — so
  // "WWW.example.com" is handled the same as "www.example.com".
  host = host.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);

  // Drop the trailing slash from the path.
  path = path.replace(/\/+$/, "");

  if (!host) return "";
  if (!path) return host;
  return `${host}/${path}`;
}

/**
 * Two URLs point at the same gallery?
 *
 * Falls back to an exact string comparison when either side cannot be
 * parsed, so a malformed URL is never treated as a duplicate of everything
 * else — it just won't match anything.
 */
export function isSamePictureSource(a: string, b: string): boolean {
  const keyA = pictureSourceKey(a);
  const keyB = pictureSourceKey(b);
  if (!keyA || !keyB) return (a || "").trim() === (b || "").trim();
  return keyA === keyB;
}
