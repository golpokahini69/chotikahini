/**
 * Shared helpers for the site's RSS feeds.
 *
 * Both `/rss.xml` (stories) and `/rss-pictures.xml` (picture galleries)
 * emit RSS 2.0 and need the same escaping and CDATA helpers. They live
 * here so the two routes cannot drift apart.
 */

/**
 * Escape the five XML predefined entities.
 *
 * The sitemap already had this helper (`app/sitemap.xml/route.ts`); it is
 * duplicated here rather than imported because the sitemap route is a
 * route module and importing across route modules is fragile. The
 * implementation is identical and verified against the live feed.
 */
export function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return c;
    }
  });
}

/**
 * Wrap text in a CDATA section, neutralising any embedded `]]>`.
 *
 * A raw `]]>` inside the text would terminate the CDATA section early and
 * produce malformed XML, so it is split across two sections.
 */
export function cdata(text: string): string {
  const safe = (text || "").replace(/\]\]>/g, "]]]]><![CDATA[>");
  return `<![CDATA[${safe}]]>`;
}

/**
 * XML-escape a value for use in an attribute (e.g. `url="…"`).
 * Same rules as `escapeXml`, kept as a named alias for readability.
 */
export function escapeAttr(unsafe: string): string {
  return escapeXml(unsafe);
}

/** The standard headers every feed response is served with. */
export function feedHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    "CDN-Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
  };
}
