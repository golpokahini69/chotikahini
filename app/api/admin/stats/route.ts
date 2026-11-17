import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { CACHE_TAGS, cachedRead } from "@/lib/cache";

/**
 * GET /api/admin/stats — dashboard overview numbers.
 *
 * Design rules (this is one of the most-called admin endpoints):
 *   • EVERY independent read runs inside ONE Promise.all — the old version
 *     awaited them in sequence, so latency summed up (~10 round-trips).
 *     The scheduled-media counts used to run in a SECOND sequential batch
 *     (another full Supabase round-trip on top); they are in the same batch
 *     now, so a cold cache costs exactly ONE parallel round-trip.
 *   • Only `head: true` counts and tiny bounded reads travel: never whole
 *     tables, never raw visitor rows.
 *   • Works WITHOUT the `admin_visit_stats` RPC: that function exists in
 *     scripts/setup.sql but has not been run on the live database, so the
 *     RPC path returns an error there and every view number must still be
 *     right. Each aggregate has a cheap PostgREST fallback below.
 *   • No live-visitor counter: in-memory "online now" tracking was removed
 *     as per-product requirement (no live visitor tracking).
 *
 * ── Why the shared Data Cache instead of a process-local memo ───────────
 * Measured against the live database: EVERY PostgREST round-trip costs
 * ~1–2.4 s regardless of row count. The previous process-local 60 s memo
 * died with each serverless instance, so a cold dashboard still paid the
 * whole batch. `cachedRead` stores the aggregates in Next's shared Data
 * Cache: after one computation, every instance (and every cold start)
 * serves the numbers with zero Supabase requests for 60 s.
 *
 * The aggregates are pure counts — never per-user rows — and the per-role
 * visibility gate is re-applied on EVERY request before anything is sent,
 * so a cached value is never shown to a role that may not see it.
 * Story/user writes tag-invalidate the entry (`posts` / `users`), so the
 * numbers refresh immediately after a publish.
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

/** The aggregate batch itself — cached for 60 s in the shared Data Cache. */
const readStatsBatch = cachedRead(
  "admin-stats-batch",
  async (): Promise<Record<string, unknown>> => {
    const supabase = getSupabaseAdmin();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();
    const nowIso = new Date().toISOString();
    const mediaNow = nowIso;

    const ROLES = ["superadmin", "admin", "author", "user"] as const;

    // ── ONE parallel batch: every result is a count or a small bounded set ──
    const [
      usersCountRes,
      roleCountRes,
      todayReadersRes,
      storyViewTotalRes,
      storyCountRes,
      statusRowsRes,
      pendingRowsRes,
      scheduledVideosRes,
      scheduledPicturesRes,
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

      // 8/9. Scheduled media — previously a SECOND sequential batch (another
      //      full round-trip); same Promise.all now.
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

    // "Today's hits" = readers today.
    //
    // This used to also head-count `page_visits` first — but that table does
    // not exist on the live database (measured: HTTP 404), so the query was
    // a guaranteed ~1–2s failure on every dashboard load before falling back
    // to exactly the number it now returns directly.
    const dailyCount = todayVisitorsCount;

    return {
      totalUsers,
      rolesCount,
      dailyCount,
      totalPageViews: totalViewCount,
      totalStories,
      publishedStories,
      pendingStories,
      scheduledStories,
      scheduledVideos: scheduledVideosRes.count ?? 0,
      scheduledPictures: scheduledPicturesRes.count ?? 0,
    };
  },
  {
    revalidate: 60,
    tags: [CACHE_TAGS.posts, CACHE_TAGS.users],
  },
);

export async function GET() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "analytics.view")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const canSeeUserStats = hasPermission(session.role, "users.view");

  try {
    const payload = await readStatsBatch();

    return NextResponse.json({
      totalUsers: canSeeUserStats ? payload.totalUsers : undefined,
      rolesCount: canSeeUserStats ? payload.rolesCount : undefined,
      dailyCount: payload.dailyCount,
      totalPageViews: payload.totalPageViews,
      totalStories: payload.totalStories,
      publishedStories: payload.publishedStories,
      pendingStories: payload.pendingStories,
      scheduledStories: payload.scheduledStories,
      scheduledVideos: payload.scheduledVideos,
      scheduledPictures: payload.scheduledPictures,
    });
  } catch (error) {
    console.error("Failed to fetch admin stats:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
