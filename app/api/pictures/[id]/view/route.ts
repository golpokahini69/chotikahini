import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildViewerKey, getCachedCount, isCounted, markCounted, setCachedCount } from "@/lib/view-count";

export const dynamic = "force-dynamic";

/**
 * Count one picture-gallery view.
 *
 * Same three-layer shape as /api/videos/[id]/view:
 *
 *   1. in-process dedupe + read cache (lib/view-count.ts) — a repeat hit
 *      costs zero database round-trips;
 *   2. one atomic RPC (`record_picture_view`) — insert + increment in a
 *      single statement, so concurrent visitors cannot overwrite each
 *      other's number;
 *   3. table-level fallback when the RPC has not been installed yet, so a
 *      missing migration can no longer silently zero the counter.
 *
 * This is OUR site's view count. It is separate from the provider's own
 * `source_views`, which is scraped and displayed as-is.
 */

interface RouteContext {
  params: Promise<{ id: string }>;
}

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
const cacheKey = (id: string) => `picture:${id}`;

/** Returns the new count when the write landed, null when it did not. */
async function incrementInDatabase(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  galleryId: string,
  viewerKey: string,
): Promise<number | null> {
  const { data, error } = await supabase.rpc("record_picture_view", {
    p_gallery_id: galleryId,
    p_viewer_key: viewerKey,
  });

  if (!error && data) {
    return ((data ?? {}) as { view_count?: number }).view_count ?? null;
  }

  if (error) {
    console.error(
      `[picture-view] record_picture_view unavailable (${error.code ?? ""} ${error.message}) — ` +
        `using the table-level fallback. Run scripts/setup.sql to install the RPC.`,
    );
  }

  const { data: inserted, error: insertError } = await supabase
    .from("picture_views")
    .upsert(
      { gallery_id: galleryId, viewer_key: viewerKey },
      { onConflict: "gallery_id,viewer_key", ignoreDuplicates: true },
    )
    .select("id");

  if (insertError) {
    // picture_views missing (migration never ran). Previously that meant a
    // silent zero forever; count now, with in-process dedupe as the only
    // guard, and make the missing migration visible in the logs.
    console.error(
      `[picture-view] picture_views unavailable (${insertError.code ?? ""} ${insertError.message}) — ` +
        `counting with in-process dedupe only. Run scripts/setup.sql to restore per-viewer dedupe.`,
    );
  } else if (!inserted || inserted.length === 0) {
    return null; // this gallery was already recorded for this viewer today
  }

  const { data: current, error: readError } = await supabase
    .from("picture_galleries")
    .select("view_count")
    .eq("id", galleryId)
    .maybeSingle();
  if (readError) {
    console.error("[picture-view] fallback read failed:", readError.message);
    return null;
  }
  if (current === null) return null; // no such gallery

  const next = (current.view_count || 0) + 1;
  const { data: updated, error: writeError } = await supabase
    .from("picture_galleries")
    .update({ view_count: next })
    .eq("id", galleryId)
    .select("view_count");
  if (writeError) {
    console.error("[picture-view] fallback increment failed:", writeError.message);
    return null;
  }
  if (!updated || updated.length === 0) return null; // gallery did not exist
  return (updated[0].view_count as number) ?? null;
}

export async function POST(req: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    const body = (await req.json().catch(() => ({}))) as { visitorId?: string };
    const viewerKey = buildViewerKey(req, body?.visitorId);
    const dedupeKey = `picture:${id}:${viewerKey}`;

    // Already counted for this viewer today → answer from memory, no DB.
    if (isCounted(dedupeKey)) {
      return NextResponse.json({
        counted: false,
        viewCount: getCachedCount(cacheKey(id)) ?? 0,
      });
    }

    const supabase = getSupabaseAdmin();
    const next = await incrementInDatabase(supabase, id, viewerKey);

    if (next === null) {
      // Nothing written — leave the viewer unmarked so the next page load
      // retries instead of swallowing the view.
      return NextResponse.json({
        counted: false,
        viewCount: getCachedCount(cacheKey(id)) ?? 0,
      });
    }

    markCounted(dedupeKey, DEDUPE_WINDOW_MS);
    setCachedCount(cacheKey(id), next);
    return NextResponse.json({ counted: true, viewCount: next });
  } catch (e) {
    console.error("[picture-view] unexpected error:", e);
    return NextResponse.json({ counted: false, viewCount: 0 });
  }
}

/** Read-only count lookup, cached for a minute at the edge. */
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
      .from("picture_galleries")
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
