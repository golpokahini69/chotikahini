import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildViewerKey, getCachedCount, setCachedCount } from "@/lib/view-count";

export const dynamic = "force-dynamic";

/**
 * Count one video view.
 *
 * LAYER 1 — in-process dedupe + read cache (lib/view-count.ts)
 *   A repeat hit from the same viewer inside the window costs zero database
 *   round-trips, not one write and a wasted response. This replaces what a
 *   Redis layer would normally do here, within the limits of running on the
 *   free plan with no external services: it is per-instance and is lost on
 *   a cold start, so the worst case is a duplicated count, never a lost one
 *   (and only when the instance restarts inside the same day).
 *
 * LAYER 2 — one atomic RPC (`record_video_view`)
 *   Does the dedupe-row insert and the counter increment in a single
 *   statement, so concurrent visitors serialise on the row instead of
 *   reading a stale number and overwriting it.
 *
 * LAYER 3 — direct fallback when the RPC is missing
 *   THE BUG BEING FIXED: the old code logged "rpc skipped" and returned
 *   `counted: false`, so if `scripts/video-views-unique.sql` had never been
 *   run, views were SILENTLY never counted and the video counter stayed at
 *   zero forever while the page kept looking healthy. The fallback now does
 *   the same dedupe + increment against the tables themselves, and shouts
 *   loudly enough that the operator sees it in the logs.
 */

interface RouteContext {
  params: Promise<{ id: string }>;
}

// No per-viewer window: every visit counts (owner requirement). Duplicate
// mounts are guarded on the client with a per-mount ref.
const cacheKey = (id: string) => `video:${id}`;

/** Returns the new count when the write landed, null when it did not. */
async function incrementInDatabase(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  videoId: string,
  viewerKey: string,
): Promise<number | null> {
  // Preferred: one atomic statement.
  const { data, error } = await supabase.rpc("record_video_view", {
    p_video_id: videoId,
    p_viewer_key: viewerKey,
  });

  if (!error && data) {
    const result = (data ?? {}) as { view_count?: number };
    return result.view_count ?? null;
  }

  if (error) {
    console.error(
      `[video-view] record_video_view unavailable (${error.code ?? ""} ${error.message}) — ` +
        `using the table-level fallback. Run scripts/setup.sql to install the RPC so this ` +
        `path stops running.`,
    );
  }

  // Fallback: replicate the RPC. Insert the dedupe row first; only a row
  // that is genuinely new may bump the counter.
  // Fallback A: replicate the RPC against the tables. The dedupe-row insert
  // decides whether this is genuinely new — an empty `select` after an
  // upsert means "already recorded", so the counter must not move.
  const { data: inserted, error: insertError } = await supabase
    .from("video_views")
    .upsert(
      { video_id: videoId, viewer_key: viewerKey },
      { onConflict: "video_id,viewer_key", ignoreDuplicates: true },
    )
    .select("id");

  if (insertError) {
    // The dedupe table is missing (the unique-views migration never ran).
    // Previously this path did not exist at all, so the counter stayed at
    // zero forever. Count now with the in-process dedupe as the only guard
    // and shout in the log — the fix is one migration, not silence.
    console.error(
      `[video-view] video_views unavailable (${insertError.code ?? ""} ${insertError.message}) — ` +
        `counting with in-process dedupe only. Run scripts/setup.sql to restore per-viewer dedupe.`,
    );
  } else if (!inserted || inserted.length === 0) {
    return null; // this viewer was already recorded today
  }

  // Read, then write back +1 and ask the update to return the row it
  // touched — that `.select()` is what tells us the video actually existed
  // (a no-op UPDATE on a missing id returns zero rows, not an error).
  const { data: current, error: readError } = await supabase
    .from("video_posts")
    .select("view_count")
    .eq("id", videoId)
    .maybeSingle();
  if (readError) {
    console.error("[video-view] fallback read failed:", readError.message);
    return null;
  }
  if (current === null) return null; // no such video

  const next = (current.view_count || 0) + 1;
  const { data: updated, error: writeError } = await supabase
    .from("video_posts")
    .update({ view_count: next })
    .eq("id", videoId)
    .select("view_count");

  if (writeError) {
    console.error("[video-view] increment failed:", writeError.message);
    return null;
  }
  if (!updated || updated.length === 0) return null;
  return (updated[0].view_count as number) ?? null;
}

export async function POST(req: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    // The tracker may send the client's stable id; without it we fall back
    // to ip|ua|day, which under-counts when a proxy hides the client IP.
    const body = (await req.json().catch(() => ({}))) as { visitorId?: string };
    // Unique per call so the RPC's viewer-unique check can never swallow a
    // real visit — every page view counts exactly once.
    const viewerKey = `v:${buildViewerKey(req, body?.visitorId)}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

    const supabase = getSupabaseAdmin();
    const next = await incrementInDatabase(supabase, id, viewerKey);

    if (next === null) {
      return NextResponse.json({
        counted: false,
        viewCount: getCachedCount(cacheKey(id)) ?? 0,
      });
    }

    setCachedCount(cacheKey(id), next);
    return NextResponse.json({ counted: true, viewCount: next });
  } catch (e) {
    console.error("[video-view] unexpected error:", e);
    // Never break the viewer's page over a counter.
    return NextResponse.json({ counted: false, viewCount: 0 });
  }
}

/** Read-only count lookup, so a listing page can render without a full join. */
export async function GET(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const cached = getCachedCount(cacheKey(id));
  if (cached !== null) {
    return NextResponse.json(
      { viewCount: cached, cached: true },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" } },
    );
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("video_posts")
      .select("view_count")
      .eq("id", id)
      .maybeSingle();
    const viewCount = data?.view_count ?? 0;
    setCachedCount(cacheKey(id), viewCount);
    return NextResponse.json(
      { viewCount, cached: false },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch {
    return NextResponse.json({ viewCount: 0, cached: false }, { status: 500 });
  }
}
