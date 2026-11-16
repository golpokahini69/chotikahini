import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Admin-only analytics aggregation endpoint. */
export async function GET() {
  try {
    const session = await getSession();
    if (!session || !hasPermission(session.role, "analytics.view")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const canSeeUserStats = hasPermission(session.role, "users.view");

    const supabase = getSupabaseAdmin();

    // --- Total registered users ---
    let totalUsers = 0;
    try {
      const { count } = await supabase
        .from("users")
        .select("*", { count: "exact", head: true });
      totalUsers = count || 0;
    } catch {}

    // --- Active users (last_seen_at within 24h / 7d) ---
    let activeToday = 0;
    let active7d = 0;
    try {
      const { count: today } = await supabase
        .from("users")
        .select("*", { count: "exact", head: true })
        .gte("last_seen_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
      activeToday = today || 0;

      const { count: week } = await supabase
        .from("users")
        .select("*", { count: "exact", head: true })
        .gte("last_seen_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
      active7d = week || 0;
    } catch {}

    // --- page_visits aggregates ---
    // Computed inside Postgres by `admin_visit_stats`. The earlier version
    // pulled up to 1000 raw rows per question and aggregated in Node: four
    // round-trips, thousands of rows over the wire on every dashboard open
    // (the egress cost), and a silent 1000-row cap that made the totals
    // wrong. This is one call returning three small aggregates.
    let totalVisits = 0;
    let uniqueVisitors = 0;
    let dailyStats: { date: string; visits: number; uniqueVisitors: number }[] = [];

    try {
      const { data, error } = await supabase.rpc("admin_visit_stats", { p_days: 14 });
      if (!error && data) {
        const stats = data as {
          totalVisits?: number;
          uniqueVisitors?: number;
          daily?: typeof dailyStats;
        };
        totalVisits = stats.totalVisits || 0;
        uniqueVisitors = stats.uniqueVisitors || 0;
        dailyStats = stats.daily || [];
      }
    } catch {
      // page_visits table doesn't exist yet (run scripts/setup.sql)
    }

    return NextResponse.json({
      totalUsers: canSeeUserStats ? totalUsers : undefined,
      activeToday: canSeeUserStats ? activeToday : undefined,
      active7d: canSeeUserStats ? active7d : undefined,
      totalVisits,
      uniqueVisitors,
      dailyStats,
    });
  } catch (error) {
    console.error("Analytics error:", error);
    return NextResponse.json({ error: "Failed to fetch analytics" }, { status: 500 });
  }
}