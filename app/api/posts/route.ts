import { NextResponse } from "next/server";
import { getAllPostsAsync } from "@/lib/posts";

// These responses are cached by the CDN (Cache-Control / CDN-Cache-Control
// headers below), which costs ZERO ISR writes. An `revalidate` export here
// ALSO created an ISR entry per response and rewrote it on a timer — pure
// Vercel-budget waste on top of the edge cache that was already serving it.
export const dynamic = "force-static";

/**
 * Public post index (slug / title / category / tags only — no user data).
 * Served from the CDN so repeat reads do not invoke the function; the
 * underlying data is already cached via lib/cache.ts and is invalidated
 * by `clearPostsCache()` on every story write.
 */
const POSTS_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=7200",
  "CDN-Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
};

export async function GET() {
  const posts = await getAllPostsAsync();
  const minimalPosts = posts.map(p => ({
    slug: p.slug,
    title: p.title,
    categoryId: p.categoryId,
    categoryName: p.categoryName || p.categoryId,
    tags: p.tags || []
  }));
  return NextResponse.json(minimalPosts, {
    headers: POSTS_CACHE_HEADERS,
  });
}