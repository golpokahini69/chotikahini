import { getSiteConfig, isPictureSectionEnabled } from "@/lib/config";
import { formatRssDate, todayDhaka } from "@/lib/utils";
import { listPublishedPictures } from "@/lib/pictures";
import { escapeXml, cdata, feedHeaders } from "@/lib/rss";

// Picture galleries are a separate content type from stories, so they get
// their own feed. They used to be a SECOND <channel> inside `/rss.xml`,
// but RSS 2.0 allows exactly one <channel> per feed — some readers (notably
// several Android ones) only parse the first channel and then show a feed
// that appears broken.
export const revalidate = 86400;

const MAX_ITEMS = 50;

export async function GET() {
  const site = getSiteConfig();
  const baseUrl = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;

  let pictureItems = "";

  if (isPictureSectionEnabled()) {
    try {
      const { pictures } = await listPublishedPictures({ pageSize: MAX_ITEMS });
      if (pictures && pictures.length > 0) {
        pictureItems = pictures
          .map((gallery) => {
            const slug = gallery.public_slug;
            const link = slug
              ? `${baseUrl}/image/${slug}`
              : `${baseUrl}/pictures/${gallery.id}`;
            const desc =
              gallery.description ||
              (gallery.model_name
                ? `${gallery.title} — ${gallery.model_name}`
                : gallery.title) ||
              "";
            const rssCategories = [
              gallery.model_name,
              gallery.channel_name,
              ...(Array.isArray(gallery.categories) ? gallery.categories : []),
              ...(Array.isArray(gallery.tags) ? gallery.tags : []),
            ].filter(Boolean) as string[];

            return `
    <item>
      <title>${cdata(gallery.title)}</title>
      <description>${cdata(desc)}</description>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${formatRssDate(gallery.published_at)}</pubDate>
      ${rssCategories.map((cat) => `<category>${escapeXml(cat)}</category>`).join("\n      ")}
      ${"" /* No <media:content> here: the gallery cover is a scraped
             adult-site image and there is no per-gallery share card to
             point at, so the element is omitted rather than leaking the
             raw cover. */}
    </item>`;
          })
          .join("\n");
      }
    } catch (err) {
      console.error("[rss-pictures] Failed to fetch picture galleries:", err);
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${escapeXml(`${site.title} — ছবি`)}</title>
    <description>${escapeXml(site.seo?.description || site.description)}</description>
    <link>${escapeXml(`${baseUrl}/pictures`)}</link>
    <atom:link href="${escapeXml(baseUrl + "/rss-pictures.xml")}" rel="self" type="application/rss+xml"/>
    <language>${escapeXml(site.locale)}</language>
    <lastBuildDate>${formatRssDate(todayDhaka() + "T00:00:00+06:00")}</lastBuildDate>
    <generator>${escapeXml(site.title)}</generator>
    <ttl>60</ttl>
    ${pictureItems}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: feedHeaders(),
  });
}
