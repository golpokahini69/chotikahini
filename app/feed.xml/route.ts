import { GET as rssFeed } from "@/app/rss.xml/route";

/**
 * `/feed.xml` — a common feed path readers probe. Serves the real feed
 * rather than the catch-all story route's HTML, which a reader cannot parse.
 */
export const revalidate = 86400;

export async function GET() {
  return rssFeed();
}
