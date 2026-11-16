import { GET as rssFeed } from "@/app/rss.xml/route";

/**
 * `/feed` — a common path readers probe when they look for a site's feed.
 *
 * It used to be handled by the catch-all story route, which returned the
 * homepage HTML with a 200. A reader that fetched it got HTML where it
 * expected XML and treated the feed as broken. This serves the real feed
 * instead, so a reader that guesses the URL lands on working XML.
 */
export const revalidate = 86400;

export async function GET() {
  return rssFeed();
}
