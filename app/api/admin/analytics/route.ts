import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics — active-user aggregates, zero rows.
 *
 * ── Measured root cause of the "very slow analytics" complaint ───────────
 * Every request to the live Supabase REST API now measures **1.0–2.4s**
 * regardless of table or result size (probe: 6 tables × repeated runs), so
 * COST = (request count) × (latency), and the old implementation stacked
 * them SEQUENTIALLY:
 *   • it read ALL `reading_history` rows — measured 1.2–6.4s and 14 KB
 *     every dashboard open;
 *   • it issued four ≤1000-row `page_visits` reads (total, unique, daily,
 *     top), one after another — and `page_visits` does not even exist on
 *     the live database (probe: HTTP 404 twice), so each of those waited
 *     for a failure and then rendered zeros;
 *   • `admin_visit_stats` is also not installed there (it lives only in
 *     scripts/setup.sql), so the RPC path failed too;
 *   • the dashboard re-fired `fetchStats` every 30s forever.
 * Net effect: ~8–15s of serial round-trips for numbers that were mostly 0.
 *
 * ── Now ──────────────────────────────────────────────────────────────────
 *   • TWO head-counts (0 rows) run in ONE Promise.all batch;
 *   • the result is memoised in-process for 60s — tab switches and returns
 *     cost no Supabase request at all;
 *   • NO page_visits, NO reading_history rows, NO RPC dependency: the
 *     widget set was cut to what the live database can actually answer
 *     (per brief §5/§6: drop widgets that only feed off raw event history
 *     that we no longer collect — the per-day visit chart and the
 *     "total visits" card were permanently 0/empty here and are removed);
 *   • each count is failure-isolated (safeCount);
 *   • `private, no-store` — admin numbers are never publicly cached.
 *
 * Kept aggregates: active users today, active users in 7 days (from
 * `last_seen_at`, written at login — not visitor tracking), registered
 * users. Total story views and today's hits stay in /api/admin/stats.
 */

const CACHE_TTL_MS = 60_000;

interface Aggregates {
  activeToday: number;
  active7d: number;
}

let aggregateCache: { value: Aggregates; expires: number } | null = null;

/** A rejected count returns a zero instead of failing the whole panel. */
async function safeCount(promise: PromiseLike<{ count: number | null }>): Promise<number> {
  try {
    const { count } = await promise;
    return count || 0;
  } catch {
    return 0;
  }
}

async function loadAggregates(): Promise<Aggregates> {
  if (aggregateCache && aggregateCache.expires > Date.now()) {
    return aggregateCache.value;
  }

  const supabase = getSupabaseAdmin();
  const dayStart24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const dayStart7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // ONE batch: two indexed head-counts, zero rows, parallel — wall time
  // equals the slowest single request (~one round-trip), not their sum.
  const [activeToday, active7d] = await Promise.all([
    safeCount(
      supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .gte("last_seen_at", dayStart24h),
    ),
    safeCount(
      supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .gte("last_seen_at", dayStart7d),
    ),
  ]);

  const value: Aggregates = { activeToday, active7d };
  aggregateCache = { value, expires: Date.now() + CACHE_TTL_MS };
  return value;
}

/** Admin-only analytics aggregation endpoint. */
export async function GET() {
  try {
    const session = await getSession();
    if (!session || !hasPermission(session.role, "analytics.view")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const canSeeUserStats = hasPermission(session.role, "users.view");

    const agg = await loadAggregates();

    return NextResponse.json(
      {
        activeToday: canSeeUserStats ? agg.activeToday : undefined,
        active7d: canSeeUserStats ? agg.active7d : undefined,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    // One failed analytics request must not block the dashboard: the client
    // keeps whatever it already rendered and this stays a single 500 here.
    console.error("Analytics error:", error);
    return NextResponse.json({ error: "Failed to fetch analytics" }, { status: 500 });
  }
}
