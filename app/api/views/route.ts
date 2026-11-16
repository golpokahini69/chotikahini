import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

const viewsCache = new Map<string, { views: number; timestamp: number }>();
const VIEWS_CACHE_TTL = 60_000; // 1 minute in-memory cache
const recentViews = new Map<string, number>(); // in-memory deduplication window
const VIEW_DEDUPE_MS = 10 * 60 * 1000; // 10 minutes per visitor per story

const viewHeaders = {
  "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
  "CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug");

    if (!slug) {
      return NextResponse.json({ error: "Slug required" }, { status: 400 });
    }

    const cached = viewsCache.get(slug);
    if (cached && Date.now() - cached.timestamp < VIEWS_CACHE_TTL) {
      return NextResponse.json(
        { views: cached.views },
        { headers: viewHeaders }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("post_views")
      .select("view_count")
      .eq("post_slug", slug)
      .maybeSingle();
    if (error) throw error;

    const views = data?.view_count || 0;
    viewsCache.set(slug, { views, timestamp: Date.now() });

    return NextResponse.json({ views }, { headers: viewHeaders });
  } catch (error) {
    console.error("Failed to fetch views", error);
    return NextResponse.json({ error: "Failed to fetch views" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { slug, visitorId } = await req.json();
    if (!slug) {
      return NextResponse.json({ error: "Slug required" }, { status: 400 });
    }

    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      req.headers.get("cf-connecting-ip") ||
      "anon_ip";

    const effectiveVisitorId = String(visitorId || clientIp).slice(0, 64);
    const dedupeKey = `${effectiveVisitorId}:${slug}`;
    const now = Date.now();

    // In-memory deduplication: if this visitor viewed this story in the last
    // 10 minutes, skip every database read and write.
    const lastViewTime = recentViews.get(dedupeKey);
    const cached = viewsCache.get(slug);

    if (lastViewTime && now - lastViewTime < VIEW_DEDUPE_MS) {
      return NextResponse.json({
        success: true,
        views: cached?.views || 0,
        incremented: false,
      });
    }

    recentViews.set(dedupeKey, now);

    if (recentViews.size > 10000) {
      for (const [k, time] of recentViews.entries()) {
        if (now - time > VIEW_DEDUPE_MS) recentViews.delete(k);
      }
    }

    const supabase = getSupabaseAdmin();

    // ONE atomic round-trip. This used to be: resolve post_id → SELECT the
    // counter → write count+1 → (repeat for a second table). That is up to
    // four round-trips per view and a read-modify-write race that lost
    // counts under concurrency. The RPC does the whole thing in Postgres.
    const { data, error } = await supabase.rpc("record_post_view", {
      p_slug: String(slug).slice(0, 300),
    });

    if (error) throw error;

    const views =
      (data as { view_count?: number } | null)?.view_count ?? cached?.views ?? 0;

    viewsCache.set(slug, { views, timestamp: now });
    return NextResponse.json({ success: true, views, incremented: true });
  } catch (error) {
    console.error("Failed to update views", error);
    return NextResponse.json({ error: "Failed to update views" }, { status: 500 });
  }
}
