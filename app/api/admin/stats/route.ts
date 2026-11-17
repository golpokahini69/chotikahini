import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

/**
 * GET /api/admin/stats — dashboard overview numbers.
 *
 * Design rules (this is one of the most-called admin endpoints):
 *   • EVERY independent read runs inside ONE Promise.all — the old version
 *     awaited them in sequence, so latency summed up (~10 round-trips).
 *   • Only `head: true` counts and tiny bounded reads travel: never whole
 *     tables, never raw visitor rows.
 *   • Works WITHOUT the `admin_visit_stats` RPC: that function exists in
 *     scripts/setup.sql but has not been run on the live database, so the
 *     RPC path returns an error there and every view number must still be
 *     right. Each aggregate has a cheap PostgREST fallback below.
 *   • No live-visitor counter: in-memory "online now" tracking was removed
 *     as per-product requirement (no live visitor tracking).
 */

/**
 * Sum of story view totals — RPC first, then a bounded read of the
 * per-story aggregate table.
 *
 * The RPC lives only in scripts/setup.sql and has NOT been run on the live
 * database, where it fails. Measured live: every failed round-trip still
 * costs ~1–2 seconds, so the miss is NEGATIVE-CACHED for 10 minutes — the
 * dashboard pays for the failed RPC once per process instead of on every
 * single load (and it retries after a deploy, when a `next start` restart
 * could have installed it).
 */
let rpcMissUntil = 0;

/**
 * Aggregate memo (60s, process-local).
 *
 * The dashboard re-fetches stats every time the admin navigates back to it
 * (and after every action). Auth and the per-role gate still run on every
 * request — only the numbers are reused — so returning to the dashboard
 * costs one session-hydration round-trip instead of the full count batch.
 * Values are pure aggregates (counts), never per-user rows.
 */
const STATS_TTL_MS = 60_000;
let statsCache: { value: Record<string, unknown>; expires: number } | null = null;

async function readStoryViewTotal(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<number> {
  // Preferred: one aggregate statement, no rows.
  if (Date.now() > rpcMissUntil) {
    try {
      const { data, error } = await supabase.rpc("admin_visit_stats", { p_days: 1 });
      if (error) {
        rpcMissUntil = Date.now() + 10 * 60 * 1000; // known-missing: skip for 10 min
      } else if (data) {
        const total = (data as { totalVisits?: number }).totalVisits;
        if (typeof total === "number") return total;
      }
    } catch {
      rpcMissUntil = Date.now() + 10 * 60 * 1000;
    }
  }

  // Fallback: `post_views` has ONE row per story (not per view), so this
  // read is bounded by the number of stories (~240) — about a few KB —
  // instead of anything proportional to traffic.
  try {
    const { data, error } = await supabase.from("post_views").select("view_count");
    if (error) return 0;
    let total = 0;
    for (const row of data || []) total += Number(row.view_count) || 0;
    return total;
  } catch {
    return 0;
  }
}

export async function GET() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "analytics.view")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const canSeeUserStats = hasPermission(session.role, "users.view");

  // Serve recent aggregates without touching Supabase at all. The gate is
  // re-applied per request, so a cached value is never shown to a role that
  // may not see it.
  if (statsCache && statsCache.expires > Date.now()) {
    const cached = statsCache.value;
    return NextResponse.json({
      totalUsers: canSeeUserStats ? cached.totalUsers : undefined,
      rolesCount: canSeeUserStats ? cached.rolesCount : undefined,
      dailyCount: cached.dailyCount,
      totalPageViews: cached.totalPageViews,
      totalStories: cached.totalStories,
      publishedStories: cached.publishedStories,
      pendingStories: cached.pendingStories,
      scheduledStories: cached.scheduledStories,
      scheduledVideos: cached.scheduledVideos,
      scheduledPictures: cached.scheduledPictures,
    });
  }

  try {
    const supabase = getSupabaseAdmin();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();
    const nowIso = new Date().toISOString();

    const ROLES = ["superadmin", "admin", "author", "user"] as const;

    // ── One parallel batch: every result is a count or a small bounded set ──
    const [
      usersCountRes,
      roleCountRes,
      todayReadersRes,
      storyViewTotalRes,
      storyCountRes,
      statusRowsRes,
      pendingRowsRes,
    ] = await Promise.all([
      // 1. Registered users — count only (the old `select('*')` of the whole
      //    users table crossed the wire on every dashboard load).
      supabase.from("users").select("id", { count: "exact", head: true }),

      // 2. Per-role counts — four indexed head-counts, in parallel.
      Promise.all(
        ROLES.map((role) =>
          supabase
            .from("users")
            .select("id", { count: "exact", head: true })
            .eq("role", role),
        ),
      ),

      // 3. Readers today — head-count (feeds the "today" fallback).
      supabase
        .from("reading_history")
        .select("user_id", { count: "exact", head: true })
        .gte("last_read_at", todayIso),

      // 4. Total story views — RPC first, bounded fallback second.
      readStoryViewTotal(supabase),

      // 5. Total stories — count only.
      supabase.from("stories").select("uid", { count: "exact", head: true }),

      // 6. Story status classification — bounded to the catalogue (~240
      //    rows) and narrowed to 4 short columns. Needed because "scheduled"
      //    is a future timestamp inside the published bucket, and pending
      //    stories whose history says "crawled" must not count as author
      //    submissions.
      supabase
        .from("stories")
        .select("uid, status, published_at, scheduled_at")
        .limit(1000),

      // 7. Pending stories only — fetched only for the pending bucket.
      supabase
        .from("stories")
        .select("uid, history")
        .eq("status", "pending")
        .limit(1000),
    ]);

    const totalUsers = usersCountRes.count || 0;

    const rolesCount = { superadmin: 0, admin: 0, author: 0, user: 0 } as Record<string, number>;
    roleCountRes.forEach((res, i) => {
      rolesCount[ROLES[i]] = res.count || 0;
    });

    const todayVisitorsCount = todayReadersRes.count || 0;
    const totalViewCount = storyViewTotalRes;
    const totalStories = storyCountRes.count || 0;

    // ── Story status classification (same rules as before) ──
    let publishedStories = 0;
    let pendingStories = 0;
    let scheduledStories = 0;
    const crawledUids = new Set<string>();
    for (const r of pendingRowsRes.data || []) {
      const h = (r as { history?: unknown }).history;
      if (
        Array.isArray(h) &&
        h.some((e: any) => e.event === "crawled" || e.event === "auto_posted")
      ) {
        if (r.uid) crawledUids.add(r.uid);
      }
    }
    for (const r of statusRowsRes.data || []) {
      const st = r.status || "published";
      const isFuture =
        (r.published_at && new Date(r.published_at) > new Date(nowIso)) ||
        (r.scheduled_at && new Date(r.scheduled_at) > new Date(nowIso));
      const isCrawled = st === "pending" && !!r.uid && crawledUids.has(r.uid);
      if (isFuture) {
        scheduledStories++;
      } else if (st === "published") {
        publishedStories++;
      } else if (st === "pending" && !isCrawled) {
        pendingStories++;
      }
    }

    // ── Scheduled media (parallel, head-counts) ──
    const mediaNow = new Date().toISOString();
    const [vr, pr] = await Promise.all([
      supabase
        .from("video_posts")
        .select("id", { count: "exact", head: true })
        .eq("status", "published")
        .not("scheduled_at", "is", null)
        .gt("scheduled_at", mediaNow),
      supabase
        .from("picture_galleries")
        .select("id", { count: "exact", head: true })
        .eq("status", "published")
        .not("scheduled_at", "is", null)
        .gt("scheduled_at", mediaNow),
    ]);

    // "Today's hits" = readers today.
    //
    // This used to also head-count `page_visits` first — but that table does
    // not exist on the live database (measured: HTTP 404), so the query was
    // a guaranteed ~1–2s failure on every dashboard load before falling back
    // to exactly the number it now returns directly.
    const dailyCount = todayVisitorsCount;

    const payload: Record<string, unknown> = {
      totalUsers,
      rolesCount,
      dailyCount,
      totalPageViews: totalViewCount,
      totalStories,
      publishedStories,
      pendingStories,
      scheduledStories,
      scheduledVideos: vr.count ?? 0,
      scheduledPictures: pr.count ?? 0,
    };
    statsCache = { value: payload, expires: Date.now() + STATS_TTL_MS };

    return NextResponse.json({
      totalUsers: canSeeUserStats ? payload.totalUsers : undefined,
      rolesCount: canSeeUserStats ? payload.rolesCount : undefined,
      dailyCount,
      totalPageViews: totalViewCount,
      totalStories,
      publishedStories,
      pendingStories,
      scheduledStories,
      scheduledVideos: payload.scheduledVideos,
      scheduledPictures: payload.scheduledPictures,
    });
  } catch (error) {
    console.error("Failed to fetch admin stats:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
