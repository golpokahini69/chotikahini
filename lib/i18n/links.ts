import type { Locale } from "./locale";

/** Absolute URLs, protocol-relative URLs, and non-HTTP schemes. */
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const NON_HTTP_SCHEME = /^(?:mailto:|tel:|sms:|javascript:)/i;

/**
 * Paths that are NOT pages and must never receive a locale prefix.
 *
 * API routes are the important one: a client that calls `/en/api/search`
 * gets a 404, because API routes are not mirrored into the English group.
 */
const NON_PAGE_PREFIXES = [
  "/api/",
  "/_next/",
  "/images/",
  "/fonts/",
  "/uploads/",
  "/cover_pic/",
  "/rss.xml",
  "/rss-pictures.xml",
  "/feed",
  "/feed.xml",
  "/atom.xml",
  "/index.xml",
  "/sitemap.xml",
  "/robots.txt",
  "/manifest.json",
  "/favicon",
];

/** Split a path into its path part and its query/hash tail. */
function splitQuery(href: string): [string, string] {
  const match = href.match(/^([^?#]*)(.*)$/);
  if (!match) return [href, ""];
  return [match[1], match[2]];
}

/**
 * Prefix an internal page link with the active locale.
 *
 * Bangla links are returned untouched (the Bangla site lives at the root).
 * English links get an `/en` prefix. External URLs, API routes and static
 * assets are always returned unchanged.
 */
export function localizeHref(href: string, locale: Locale): string {
  if (!href) return href;
  if (EXTERNAL.test(href) || NON_HTTP_SCHEME.test(href)) return href;
  if (href.startsWith("#")) return href;
  if (NON_PAGE_PREFIXES.some((prefix) => href.startsWith(prefix))) return href;

  // Already locale-prefixed — don't double up.
  if (href === "/en" || href.startsWith("/en/")) return href;

  const [pathPart, query] = splitQuery(href);

  if (locale === "en") {
    const next = pathPart === "/" || pathPart === "" ? "/en" : `/en${pathPart}`;
    return `${next}${query}`;
  }

  return href;
}

/** Remove the `/en` prefix from a path, returning the locale-neutral form. */
export function stripLocale(href: string): string {
  if (!href) return href;
  const [pathPart, query] = splitQuery(href);
  if (pathPart === "/en") return `/${query}`;
  if (pathPart.startsWith("/en/")) return `${pathPart.slice(3)}${query}`;
  return href;
}
