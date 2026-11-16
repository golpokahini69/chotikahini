import { getAllPostsAsync, getPostContentsBulkAsync } from "@/lib/posts";
import { getSiteConfig } from "@/lib/config";
import { formatRssDate, todayDhaka } from "@/lib/utils";
import { findMatchingClusters, generateSeoDescription } from "@/lib/keyword-engine";
import { escapeXml, cdata, feedHeaders } from "@/lib/rss";
import { toPostOgUrl } from "@/lib/og-urls";

// The feed is public and changes only when a story is published, so it
// is regenerated at most once a day and served from the edge after that.
export const revalidate = 86400;

/**
 * How many stories the feed carries.
 *
 * RSS readers only ever show the newest handful (typically 20–30), and
 * `content:encoded` puts the FULL story body in every item.
 * Capping to 25 saves massive database egress while keeping feed readers up-to-date.
 * Older stories stay reachable through the sitemap.
 */
const MAX_ITEMS = 25;

/**
 * Convert a story body (plain text with blank-line-separated paragraphs)
 * into the HTML that `content:encoded` carries.
 *
 * The site's own renderer (`components/ArticleContent.tsx`) preserves every
 * line break and does not interpret markdown, so the feed does the same:
 * paragraphs become `<p>` and line breaks inside them become `<br>`.
 */
function bodyToHtml(body: string): string {
  if (!body) return "";
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return paragraphs
    .map((p) => {
      const lines = p.split("\n");
      const inner = lines
        .map((line) => escapeXml(line))
        .join("<br />");
      return `    <p>${inner}</p>`;
    })
    .join("\n");
}

export async function GET() {
  const site = getSiteConfig();
  const baseUrl = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;

  // The async loader is used on purpose: the synchronous `getAllPosts()`
  // only returns an already-populated in-memory list, which is empty on a
  // cold serverless instance and produced an empty feed.
  const allPosts = await getAllPostsAsync();
  const posts = allPosts.slice(0, MAX_ITEMS);

  // Pull every story body in ONE query instead of one query per story.
  const identifiers = posts.flatMap((p) => [p.uid, p.slug, p.fileSlug]).filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  const bodies = await getPostContentsBulkAsync(identifiers);

  const bodyFor = (post: (typeof posts)[number]): string => {
    const candidates = [post.uid, post.slug, post.fileSlug].filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
    for (const c of candidates) {
      const hit = bodies[c.toLowerCase()];
      if (hit) return hit;
    }
    return "";
  };

  const items = posts
    .map((post) => {
      // The canonical URL. The sitemap (`app/sitemap.xml/route.ts`) and
      // the page canonical (`lib/seo.ts`) both use the public slug when a
      // story has one, so the feed must use the same one — otherwise the
      // feed advertises URLs that redirect to a different canonical and
      // the story shows up twice in readers.
      const identifier = post.uid || post.slug;
      const link = post.publicSlug
        ? `${baseUrl}/golpo/${post.publicSlug}`
        : `${baseUrl}/${identifier}`;

      // Enrich RSS description with keyword data
      const rawDesc = post.description || post.content?.slice(0, 200).replace(/[#*`\[\]]/g, "") || "";
      const matches = findMatchingClusters(`${post.title} ${rawDesc}`, 1);
      const seoDesc = generateSeoDescription(rawDesc, matches, 200);

      // Collect keyword tags for RSS categories
      const rssCategories = [post.categoryName, ...post.tags].filter(Boolean);

      const fullBody = bodyFor(post);
      const contentHtml = bodyToHtml(fullBody);

      return `
    <item>
      <title>${cdata(post.title)}</title>
      <description>${cdata(seoDesc)}</description>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${formatRssDate(post.publishedAt)}</pubDate>
      ${rssCategories.map((cat) => `<category>${escapeXml(cat)}</category>`).join("\n      ")}
      ${post.cover ? `<media:content url="${escapeXml(toPostOgUrl(post, site))}" medium="image" />` : ""}
      ${contentHtml ? `<content:encoded>${cdata(contentHtml)}</content:encoded>` : ""}
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(site.title)}</title>
    <description>${escapeXml(site.seo?.description || site.description)}</description>
    <link>${escapeXml(baseUrl)}</link>
    <atom:link href="${escapeXml(baseUrl + "/rss.xml")}" rel="self" type="application/rss+xml"/>
    <language>${escapeXml(site.locale)}</language>
    <lastBuildDate>${formatRssDate(todayDhaka() + "T00:00:00+06:00")}</lastBuildDate>
    <generator>${escapeXml(site.title)}</generator>
    <ttl>60</ttl>
    ${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: feedHeaders(),
  });
}
