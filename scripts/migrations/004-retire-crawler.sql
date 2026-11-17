-- ============================================================================
--  NEWAGE — PHASE 7 MIGRATION (STAGE 4): RETIRE "অটো পোস্ট ও স্মার্ট ক্রলার"
-- ============================================================================
--
--  NOT YET APPLIED. Review and approve before running.
--
--  WHAT WAS REMOVED FROM THE APPLICATION (same change, code side)
--    • admin dashboard section  "অটো পোস্ট ও স্মার্ট ক্রলার"
--    • sidebar nav entry        "অটো পোস্ট ও ক্রলার"
--    • POST /api/admin/auto-post
--    • GET/POST/DELETE /api/admin/crawler/{sources,run,publish}
--
--  WHAT THIS REMOVES FROM THE DATABASE
--    1. `crawler_sources`      — the watched-domain list (1 row: your source).
--    2. `site_settings` row    — key `crawler_config`, the publish schedule.
--
--  PRESERVED — NOT TOUCHED
--    • Every story the crawler published. Those are ordinary `stories` rows
--      with `history` events named "crawled" / "auto_posted". They stay
--      published, stay in the sitemap, and the admin pending counter still
--      excludes them correctly (that logic reads `stories`, not this table).
--    • `lib/article-extractor.ts` — still used by the separate
--      /api/admin/import-url feature in the Story Editor.
--
--  DEPENDENCIES VERIFIED
--    • No foreign key points at crawler_sources (its id is self-contained).
--    • No view, trigger or function references it.
--    • No application code references `crawler_sources` or `crawler_config`
--      after the route deletion (checked across app/, lib/, components/).
--
--  METHOD: RENAME, not drop. One statement restores everything.
--
--  SAFE TO RE-RUN: both operations are guarded.
-- ============================================================================


do $$
begin
  if to_regclass('public.crawler_sources') is not null
     and to_regclass('public._retired_crawler_sources') is null then
    -- RLS policies, grants and indexes all move with the table.
    alter table public.crawler_sources rename to _retired_crawler_sources;
    raise notice 'crawler_sources retired';
  end if;

  if exists (select 1 from public.site_settings where key = 'crawler_config') then
    -- Backed up in-place first, so rollback is a single statement against
    -- the same row rather than a reconstructed jsonb value.
    insert into public.site_settings (key, value, updated_at)
    select '_retired_crawler_config', value, now()
      from public.site_settings
     where key = 'crawler_config'
    on conflict (key) do update
      set value = excluded.value, updated_at = excluded.updated_at;

    delete from public.site_settings where key = 'crawler_config';
    raise notice 'crawler_config retired (backup kept as _retired_crawler_config)';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- §ROLLBACK — restore both objects exactly as they were.
-- ---------------------------------------------------------------------------

-- alter table if exists public._retired_crawler_sources rename to crawler_sources;
--
-- insert into public.site_settings (key, value, updated_at)
--   select 'crawler_config', value, now()
--     from public.site_settings where key = '_retired_crawler_config'
--   on conflict (key) do update
--     set value = excluded.value, updated_at = excluded.updated_at;
-- delete from public.site_settings where key = '_retired_crawler_config';


-- ---------------------------------------------------------------------------
-- §LATER, when you are satisfied: reclaim the disk.
-- ---------------------------------------------------------------------------

-- drop table public._retired_crawler_sources;
-- delete from public.site_settings where key = '_retired_crawler_config';
