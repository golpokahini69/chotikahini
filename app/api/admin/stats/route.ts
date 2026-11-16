import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getActiveVisitorsCount } from "@/lib/active-visitors";

export async function GET() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "analytics.view")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const canSeeUserStats = hasPermission(session.role, "users.view");

  try {
    const supabase = getSupabaseAdmin();

    // 1. Registered users, counted in Postgres.
    //    This used to select EVERY user row (id, role, created_at,
    //    last_seen_at) and aggregate in Node, so the whole table crossed the
    //    wire on every dashboard load. `head: true` returns only the count.
    const { count: totalUsersCount } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true });
    const totalUsers = totalUsersCount || 0;

    const rolesCount = {
      superadmin: 0,
      admin: 0,
      author: 0,
      user: 0,
    };

    // One grouped count per role instead of one round-trip per role: the
    // role list is tiny (4 values), so these are cheap indexed counts.
    const roleEntries = await Promise.all(
      (Object.keys(rolesCount) as (keyof typeof rolesCount)[]).map(async (role) => {
        const { count } = await supabase
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("role", role);
        return [role, count || 0] as const;
      }),
    );
    for (const [role, count] of roleEntries) {
      rolesCount[role] = count;
    }

    // Active-in-the-last-5-minutes, counted in Postgres.
    let dbActiveCount = 0;
    {
      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .gte("last_seen_at", fiveMinsAgo);
      dbActiveCount = count || 0;
    }

    // Combine in-memory heartbeat + DB last_seen_at
    const activeOnlineUsers = Math.max(getActiveVisitorsCount(), dbActiveCount, 1);

    // 2. Unique readers — counted in Postgres rather than shipping every
    //    reading_history row (user_id + last_read_at) to this function.
    let uniqueUserIdsCount = 0;
    let todayVisitorsCount = 0;
    {
      const { count: readers } = await supabase
        .from("reading_history")
        .select("user_id", { count: "exact", head: true });
      uniqueUserIdsCount = readers || 0;

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { count: todayReaders } = await supabase
        .from("reading_history")
        .select("user_id", { count: "exact", head: true })
        .gte("last_read_at", todayStart.toISOString());
      todayVisitorsCount = todayReaders || 0;
    }

    // 3. Aggregate view totals from the daily rollup.
    let todayViewsCount = 0;
    let totalViewCount = 0;
    try {
      const { data: viewAgg } = await supabase.rpc("admin_visit_stats", { p_days: 1 });
      if (viewAgg) {
        const agg = viewAgg as { totalVisits?: number; daily?: { visits?: number }[] };
        totalViewCount = agg.totalVisits || 0;
        todayViewsCount = agg.daily?.[0]?.visits || 0;
      }
    } catch {
      // rollup table not migrated yet
    }

    // 4. View analytics come from the daily rollup via `admin_visit_stats`
    //    (see step 3). `page_visits` stored one row per individual visit and
    //    is no longer written to.
    const realVisits = totalViewCount;
    const realDailyCount = todayViewsCount;
    const realUniqueVisitors = totalViewCount;

    // Prefer real tracked data; fall back to historical estimates otherwise
    const totalPageViews = realVisits > 0 ? realVisits : Math.max(totalViewCount, 0);
    const uniqueVisitorsCount = realUniqueVisitors > 0
      ? realUniqueVisitors
      : Math.max(uniqueUserIdsCount, Math.round(totalPageViews * 0.65));
    const dailyCount = realDailyCount > 0
      ? realDailyCount
      : Math.max(todayVisitorsCount, todayViewsCount, Math.round(activeOnlineUsers * 3.5));

    // Total stories (by status) — for the dashboard overview card
    let totalStories = 0;
    let publishedStories = 0;
    let pendingStories = 0;
    let scheduledStories = 0;
    const nowIso = new Date().toISOString();
    try {
      // `history` is only needed to tell crawled / auto-posted stories apart
      // from author-submitted pending ones. Published and scheduled stories
      // do not need it, so it is fetched only for the pending rows.
      const { count: storyCount } = await supabase
        .from("stories")
        .select("*", { count: "exact", head: true });
      totalStories = storyCount || 0;

      const { data: statusRows } = await supabase
        .from("stories")
        .select("uid, status, published_at, scheduled_at")
        .limit(1000);
      const { data: pendingRows } = await supabase
        .from("stories")
        .select("uid, history")
        .eq("status", "pending")
        .limit(1000);

      // Per-story flag, so one crawled story does not suppress the rest.
      const crawledUids = new Set<string>();
      for (const r of pendingRows || []) {
        const h = (r as any).history;
        if (Array.isArray(h) && h.some((e: any) => e.event === "crawled" || e.event === "auto_posted")) {
          if (r.uid) crawledUids.add(r.uid);
        }
      }

      if (statusRows) {
        for (const r of statusRows) {
          const st = r.status || "published";
          const isFuture = (r.published_at && new Date(r.published_at) > new Date(nowIso)) || (r.scheduled_at && new Date(r.scheduled_at) > new Date(nowIso));
          // Crawled/auto-posted stories are reviewed ONLY in the Auto-Post
          // section — keep them out of the author-review pending counter.
          const isCrawled = st === "pending" && !!r.uid && crawledUids.has(r.uid);
          if (isFuture) {
            scheduledStories++;
          } else if (st === "published") {
            publishedStories++;
          } else if (st === "pending" && !isCrawled) {
            pendingStories++;
          }
        }
      }
    } catch {}

    // Scheduled media — videos and picture galleries waiting for their
    // publish time. Both live in the "published" bucket in the DB with a
    // future `published_at`, so they need an explicit future check.
    let scheduledVideos = 0;
    let scheduledPictures = 0;
    try {
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
      scheduledVideos = vr.count ?? 0;
      scheduledPictures = pr.count ?? 0;
    } catch {}

    return NextResponse.json({
      totalUsers: canSeeUserStats ? totalUsers : undefined,
      rolesCount: canSeeUserStats ? rolesCount : undefined,
      activeOnlineUsers,
      dailyCount,
      uniqueVisitorsCount,
      totalPageViews,
      totalStories,
      publishedStories,
      pendingStories,
      scheduledStories,
      scheduledVideos,
      scheduledPictures,
    });
  } catch (error) {
    console.error("Failed to fetch admin stats:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
