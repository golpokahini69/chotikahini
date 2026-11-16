-- ============================================================================
-- Scheduled publishing for the video + picture sections — run once in the
-- Supabase SQL Editor.
--
-- Mirrors what `stories` already does for articles (scripts/migration-social-features.sql):
--
--   scheduled_at   the /moment the post is supposed to go live
--   published_at   the moment it actually went live
--
-- For a scheduled row we write `published_at = scheduled_at` (the future
-- timestamp) and `status = 'published'`. Every public read path already
-- filters on `published_at <= now()`, so the row stays invisible until its
-- time arrives — no background job is strictly required for visibility.
--
-- The cron route (app/api/cron/publish-scheduled-media/route.ts) then walks
-- the due rows, clears `scheduled_at`, and fires the chat announcement at
-- the right moment.
--
-- Idempotent — safe to re-run.
-- ============================================================================

alter table public.video_posts
  add column if not exists scheduled_at timestamptz;

alter table public.picture_galleries
  add column if not exists scheduled_at timestamptz;

-- The cron route scans for rows whose schedule has come due. A partial
-- index keeps that scan cheap no matter how many published rows exist.
create index if not exists video_posts_scheduled_idx
  on public.video_posts (scheduled_at)
  where scheduled_at is not null;

create index if not exists picture_galleries_scheduled_idx
  on public.picture_galleries (scheduled_at)
  where scheduled_at is not null;
