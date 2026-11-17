import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildViewerKey, getCachedCount, isCounted, markCounted, setCachedCount } from "@/lib/view-count";

/**
 * Story view counter.
 *
 * Every view counter on this site now goes through lib/view-count.ts:
 *
 *   1. in-process dedupe + read cache — a repeat hit from the same reader
 *      costs zero database round-trips (this is what a Redis layer would
 *      provide on a stack that allowed one);
 *   2. one atomic RPC (`record_post_view`) — the counter increment and the
 *      daily rollup in a single statement;
 *   3. table-level fallback when the RPC is missing, so an un-run migration
 *      can no longer silently freeze every story counter at its old value.
 *
 * The dedupe probe is deliberately checked BEFORE the write and marked only
 * AFTER the write succeeds: the database has no per-viewer guard here (only
 * video/picture views do), so marking first would swallow views whenever a
 * write failed, and no retry would ever happen.
 */

const STORY_DEDUPE_MS = 10 * 60 * 1000; // one view per reader per story per 10 min

const viewHeaders = {
  "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
  "CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
};

const cacheKey = (slug: string) => `story:${slug}`;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug");

    if (!slug) {
      return NextResponse.json({ error: "Slug required" }, { status: 400 });
    }

    const cached = getCachedCount(cacheKey(slug));
    if (cached !== null) {
      return NextResponse.json({ views: cached }, { headers: viewHeaders });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("post_views")
      .select("view_count")
      .eq("post_slug", slug)
      .maybeSingle();
    if (error) throw error;

    const views = data?.view_count || 0;
    setCachedCount(cacheKey(slug), views);

    return NextResponse.json({ views }, { headers: viewHeaders });
  } catch (error) {
    console.error("Failed to fetch views", error);
    return NextResponse.json({ error: "Failed to fetch views" }, { status: 500 });
  }
}

/** Returns the new count when the write landed, null when it did not. */
async function incrementInDatabase(slug: string): Promise<number | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.rpc("record_post_view", {
    p_slug: slug,
  });

  if (!error && data) {
    const count = (data as { view_count?: number } | null)?.view_count;
    return typeof count === "number" ? count : null;
  }

  if (error) {
    console.error(
      `[views] record_post_view unavailable (${error.code ?? ""} ${error.message}) — ` +
        `using the table-level fallback. Run scripts/setup.sql to install the RPC.`,
    );
  }

  // Fallback: read the counter and write it back. No per-viewer key exists
  // for stories at the database layer, so this path can race under heavy
  // concurrent load — it only has to be correct enough while the RPC is
  // being installed, not forever.
  const { data: row, error: readError } = await supabase
    .from("post_views")
    .select("view_count")
    .eq("post_slug", slug)
    .maybeSingle();
  if (readError) {
    console.error("[views] fallback read failed:", readError.message);
    return null;
  }

  const next = (row?.view_count || 0) + 1;
  const { error: writeError } = await supabase
    .from("post_views")
    .upsert(
      { post_slug: slug, view_count: next, updated_at: new Date().toISOString() },
      { onConflict: "post_slug" },
    );
  if (writeError) {
    console.error("[views] fallback write failed:", writeError.message);
    return null;
  }
  return next;
}

export async function POST(req: Request) {
  try {
    const { slug, visitorId } = await req.json();
    if (!slug) {
      return NextResponse.json({ error: "Slug required" }, { status: 400 });
    }

    const cleanSlug = String(slug).slice(0, 300);
    const viewerKey = buildViewerKey(req, visitorId);
    const dedupeKey = `story:${cleanSlug}:${viewerKey}`;

    // Already counted for this reader in this window → memory only.
    if (isCounted(dedupeKey)) {
      return NextResponse.json({
        success: true,
        views: getCachedCount(cacheKey(cleanSlug)) ?? 0,
        incremented: false,
      });
    }

    const next = await incrementInDatabase(cleanSlug);

    if (next === null) {
      // The write failed: leave the reader unmarked so the next page load
      // retries instead of losing the view permanently.
      return NextResponse.json({
        success: true,
        views: getCachedCount(cacheKey(cleanSlug)) ?? 0,
        incremented: false,
      });
    }

    markCounted(dedupeKey, STORY_DEDUPE_MS);
    setCachedCount(cacheKey(cleanSlug), next);

    return NextResponse.json({ success: true, views: next, incremented: true });
  } catch (error) {
    console.error("Failed to update views", error);
    return NextResponse.json({ error: "Failed to update views" }, { status: 500 });
  }
}
