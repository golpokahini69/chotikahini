-- ============================================================================
--  NEWAGE — PHASE 7 MIGRATION (STAGE 2): VISITOR TRACKING → AGGREGATE ONLY
-- ============================================================================
--
--  NOT YET APPLIED. Review and approve before running.
--
--  GOAL (Section H of the brief)
--    Keep:    aggregate story views (post_views) and per-day story views
--             (post_views_daily), plus video view totals (video_posts.view_count).
--    Drop:    every individual visitor record — `page_visits` stored one row
--             per visit with visitor_id, referrer, user_agent and country.
--             It was only ever read to compute counts that are now stored
--             directly in `post_views_daily`.
--
--  WHAT THIS DOES NOT TOUCH
--    • `post_views` (aggregate per story) — kept, unchanged.
--    • `video_posts.view_count` (aggregate per video) — kept, unchanged.
--    • `reading_history` — kept. It powers the reader's own "recently read"
--      list and the author's completion analytics, which are user-facing
--      features, not visitor tracking.
--    • `users.last_seen_at` — kept. One timestamp per account, used for the
--      admin dashboard's "active users" tile.
--
--  ORDER OF OPERATIONS
--    1. Backfill `post_views_daily` from the existing `page_visits` history,
--       so the admin charts do not lose their history when the table goes.
--    2. Verify the backfill against the source.
--    3. Only then rename the old table aside (NOT drop) so it can be
--       restored instantly.
--
--  SAFE TO RE-RUN: step 1 is an upsert, step 3 is guarded.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- §1  BACKFILL the daily rollup from page_visits history
-- ---------------------------------------------------------------------------
--
--  `page_visits` recorded one row per visit, so a day's view count for a
--  slug is simply that day's row count. `post_views_daily` is seeded with
--  those counts and then kept current by `record_post_view`.
--
--  ON CONFLICT DO NOTHING (not DO UPDATE) is deliberate: if the new code has
--  already been writing today's counts, this must not overwrite them with a
--  partial history.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.page_visits') is null then
    raise notice 'page_visits already retired — nothing to backfill';
    return;
  end if;

  insert into public.post_views_daily (day, post_slug, view_count)
  select viewed_at::date as day,
         slug,
         count(*) as view_count
    from public.page_visits
   group by viewed_at::date, slug
  on conflict (day, post_slug) do nothing;

  raise notice 'backfilled % rollup rows', (
    select count(*) from public.post_views_daily
  );
end $$;


-- ---------------------------------------------------------------------------
-- §2  VERIFY before retiring the source
-- ---------------------------------------------------------------------------
--
--  Compares the aggregate total in the rollup against the raw history.
--  They should match (or the rollup may hold MORE, if the live site has
--  already recorded views after the deploy). If the rollup holds LESS, stop
--  and investigate before running §3.
-- ---------------------------------------------------------------------------

do $$
declare
  raw_total    bigint;
  rollup_total bigint;
begin
  if to_regclass('public.page_visits') is null then
    return;
  end if;

  select count(*) into raw_total from public.page_visits;
  select coalesce(sum(view_count), 0) into rollup_total from public.post_views_daily;

  raise notice 'page_visits rows: %, post_views_daily total: %', raw_total, rollup_total;

  if rollup_total < raw_total then
    raise exception
      'rollup total (%) is lower than page_visits rows (%) — backfill is incomplete, NOT retiring the table',
      rollup_total, raw_total;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- §3  RETIRE the individual-visit table
-- ---------------------------------------------------------------------------
--
--  RENAMED, not dropped. The data stays on disk and one statement restores
--  it. Drop it yourself later (e.g. after a week) once the dashboard has
--  been confirmed correct:
--
--      drop table public._retired_page_visits;
--
--  Nothing references this table by foreign key, no view or trigger uses it,
--  and the only reader was `admin_visit_stats`, which now reads the rollup.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.page_visits') is not null
     and to_regclass('public._retired_page_visits') is null then
    alter table public.page_visits rename to _retired_page_visits;
    raise notice 'page_visits renamed to _retired_page_visits';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- §ROLLBACK — put the table back. No data was destroyed, so this is total.
-- ---------------------------------------------------------------------------

-- alter table if exists public._retired_page_visits rename to page_visits;
