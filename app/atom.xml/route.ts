import { GET as rssFeed } from "@/app/rss.xml/route";

/**
 * `/atom.xml` — a common feed path readers probe. The site publishes RSS
 * 2.0, so this serves the same feed rather than the catch-all story
 * route's HTML, which a reader cannot parse.
 */
export const revalidate = 86400;

export async function GET() {
  return rssFeed();
}
