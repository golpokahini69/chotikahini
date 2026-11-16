import { NextResponse } from "next/server";
import { getTrendingPosts } from "@/lib/trending";

export const dynamic = "force-dynamic";

/**
 * Public trending list (story metadata + counts only — no user data).
 * Served from the CDN so the endpoint does not invoke a function on every
 * page view, and backed by the shared server cache in `lib/trending.ts`
 * (which the sidebar also renders directly, without an HTTP round-trip).
 */
const TRENDING_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=7200",
  "CDN-Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
};

export async function GET() {
  try {
    const trending = await getTrendingPosts();
    return NextResponse.json(
      { trending },
      { headers: TRENDING_CACHE_HEADERS },
    );
  } catch (error) {
    console.error("Trending fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch trending stories" }, { status: 500 });
  }
}
