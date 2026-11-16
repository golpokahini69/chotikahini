-- ============================================================================
--  NEWAGE — PHASE 7 MIGRATION (STAGE 3): RETIRE "SHARE SUGGESTIONS"
-- ============================================================================
--
--  NOT YET APPLIED. Review and approve before running.
--
--  WHY
--    The "শেয়ার করার সাজেশন" panel has been removed from the admin
--    dashboard. It ranked published stories by an opportunity score and
--    handed out up to N per admin per day, tracking served suggestions so
--    the same story was not offered twice within a cooldown window.
--
--    With the panel gone, nothing reads or writes these tables:
--      • share_suggestion_log    — every suggestion ever served
--      • share_suggestion_daily  — per-admin per-day served counter
--
--    They were only ever written by `app/api/admin/share-suggestions`,
--    which is deleted in the same change.
--
--  VERIFIED
--    • No foreign key points at either table.
--    • No view, trigger, or function references them.
--    • No application code references them (checked across app/, lib/,
--      and components/).
--
--  NOT DATA OF VALUE
--    These rows record which story an admin was nudged to share, and when.
--    They are operational bookkeeping for a feature that no longer exists —
--    not user content, not published stories, not analytics anyone reads.
--
--  METHOD
--    RENAMED, not dropped. Reversible with one statement, and the rows stay
--    on disk until you choose to reclaim the space. Both tables are tiny
--    (13 and 55 rows), so there is nothing to gain by dropping them
--    immediately.
--
--  SAFE TO RE-RUN: guarded on the table names.
-- ============================================================================


do $$
begin
  if to_regclass('public.share_suggestion_log') is not null
     and to_regclass('public._retired_share_suggestion_log') is null then
    alter table public.share_suggestion_log rename to _retired_share_suggestion_log;
    raise notice 'share_suggestion_log retired';
  end if;

  if to_regclass('public.share_suggestion_daily') is not null
     and to_regclass('public._retired_share_suggestion_daily') is null then
    alter table public.share_suggestion_daily rename to _retired_share_suggestion_daily;
    raise notice 'share_suggestion_daily retired';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- §ROLLBACK — put both tables back with their original names.
-- ---------------------------------------------------------------------------

-- alter table if exists public._retired_share_suggestion_log rename to share_suggestion_log;
-- alter table if exists public._retired_share_suggestion_daily rename to share_suggestion_daily;
