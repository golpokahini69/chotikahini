import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Legacy visitor-tracking endpoint.
 *
 * This used to insert one `page_visits` row per visit — visitor id,
 * referrer, user agent, country — so the admin dashboard could count
 * distinct values later. Only AGGREGATE view counts are wanted now, and
 * those are recorded atomically by `record_post_view` (which also keeps the
 * per-day rollup in `post_views_daily`). Nothing needs an individual
 * browsing record, so this endpoint records nothing.
 *
 * Kept as a no-op rather than deleted so an old cached client bundle that
 * still beacons here gets a clean 200 instead of a 404.
 */
export async function POST() {
  return NextResponse.json({ ok: true });
}
