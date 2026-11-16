import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Single hit per viewer per 24-hour bucket.
 *
 * The `viewer_key` is sha256(`ip|user-agent|dayOfYear`). Any of those changing
 * counts as a "new viewer" so it's robust against simple IP rotation while
 * still de-duplicating refresh hits.
 *
 * WHY THE WORK HAPPENS IN THE DATABASE:
 *   The route used to insert with `ignoreDuplicates: true` and then ALWAYS
 *   bump the counter. The unique constraint stopped duplicate rows from
 *   landing in `video_views`, but nothing told the counter the insert had
 *   been a no-op — so every refresh and every duplicate tab inflated the
 *   number. The table was unique; the COUNT was not.
 *
 *   Now a single RPC (`record_video_view`) does the insert and the increment
 *   together, and increments ONLY when the insert was genuinely new.
 *
 * The route is intentionally tolerant: schema-missing or RPC-missing all
 * log + 200 so an in-flight migration can't break a viewer.
 */

interface RouteContext {
  params: Promise<{ id: string }>;
}

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

function dayBucket(): number {
  return Math.floor(Date.now() / DEDUPE_WINDOW_MS);
}

function viewerKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || "anon";
  const ua = req.headers.get("user-agent") || "";
  const bucket = dayBucket();
  return createHash("sha256")
    .update(`${ip}|${ua}|${bucket}`)
    .digest("hex");
}

export async function POST(req: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    const supabase = getSupabaseAdmin();
    const key = viewerKey(req);

    // One call does everything: records the view row and increments the
    // counter only when this viewer is new.
    const { data, error } = await supabase.rpc("record_video_view", {
      p_video_id: id,
      p_viewer_key: key,
    });

    if (error) {
      // The most common cause before scripts/video-views-unique.sql has been
      // run is "function record_video_view does not exist". Swallow it so the
      // page never reports errors to a real viewer.
      console.warn("[video-view] rpc skipped:", error.message);
      return NextResponse.json({ counted: false });
    }

    const result = (data ?? {}) as { counted?: boolean; view_count?: number };
    return NextResponse.json({
      counted: result.counted === true,
      viewCount: result.view_count ?? 0,
    });
  } catch (e) {
    console.error("[video-view] unexpected error:", e);
    return NextResponse.json({ counted: false });
  }
}
