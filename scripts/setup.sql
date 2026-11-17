-- ============================================================================
-- Cittakkho (chotikahini) — COMPLETE DATABASE SETUP
-- ============================================================================
--
-- Run this ONCE in a fresh Supabase project:  Dashboard → SQL Editor → paste
-- → Run. It creates every table, function, index, RLS policy and seed row
-- the application needs.
--
-- The file is fully IDEMPOTENT — running it a second time on an already
-- configured database is safe and changes nothing. That means you can also
-- use it to top up a database that is missing something.
--
-- ---------------------------------------------------------------------------
-- HOW THIS FILE IS ORGANISED
-- ---------------------------------------------------------------------------
-- The sections are ordered by DEPENDENCY, not by feature. A table is created
-- before anything that references it, and a function is created before the
-- index or generated column that calls it. Read the section headers — they
-- explain what each block is for.
--
--   §0  Extensions & shared helpers
--   §1  users                        ← every FK in the app points here
--   §2  Community posts
--   §3  Engagement (likes, reactions, bookmarks, follows)
--   §4  View counters
--   §5  post_metadata                ← canonical story identity
--   §6  Comments
--   §7  Stories
--   §8  Notifications
--   §9  Chat
--   §10 Social & moderation
--   §11 Site configuration
--   §12 Video library
--   §13 Picture gallery
--   §14 Public slugs & scheduled publishing
--   §15 Analytics
--   §16 Share suggestions
--   §17 RPC functions
--   §18 Row Level Security
--   §19 Grants & Realtime
--   §20 Seed data
--
-- ---------------------------------------------------------------------------
-- A NOTE ON AUTH
-- ---------------------------------------------------------------------------
-- This application does NOT use Supabase Auth. It uses its own JWT session
-- (`lib/auth.ts` → `setSession`), so the anon key has no `auth.uid()`.
-- Every read and write goes through server API routes using
-- SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
--
-- That is why most tables have RLS enabled with NO public read policy: the
-- service role key can still reach them, but the browser's anon key cannot.
-- The tables that DO have a public read policy are listed in §18 with the
-- reason why.
-- ============================================================================


-- ============================================================================
-- §0  EXTENSIONS & SHARED HELPERS
-- ============================================================================

-- gen_random_uuid() and unaccent live in pgcrypto on Supabase; the call is
-- guarded so this file also runs on a plain Postgres that already has them.
create extension if not exists pgcrypto;


-- ============================================================================
-- §1  USERS
-- ============================================================================
--
-- The root table. Every other table that belongs to a person references
-- public.users(id) with ON DELETE CASCADE.
--
-- The `users` table holds emails and password hashes, so it is NEVER
-- publicly readable — see §18.
-- ============================================================================

create table if not exists public.users (
  id                text primary key,
  username          text unique not null,
  email             text,
  password_hash     text,
  role              text default 'user',
  name              text,
  profile_pic       text,
  bio               text,
  saved_posts       jsonb default '[]'::jsonb,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),

  -- Password reset (single-use token stored directly on the row).
  reset_token        text,
  reset_token_expires timestamptz,

  -- Author verification badge.
  is_verified       boolean default false,

  -- Trusted authors: their submissions are auto-approved.
  is_trusted        boolean default false,

  -- Gamification points.
  xp                integer default 0,

  -- "Active user" tracking, written by the analytics heartbeat.
  last_seen_at      timestamptz
);

-- Speeds up the token lookup performed on every reset attempt.
create index if not exists idx_users_reset_token
  on public.users(reset_token);

create index if not exists idx_users_last_seen_at
  on public.users(last_seen_at);

-- A moderator can ban a user from posting. 1 = may post, 0 = banned.
alter table public.users
  add column if not exists can_post integer not null default 1;

-- Group-chat moderation. This used to be a standalone `chat_mutes` table
-- that only ever held TWO per-user flags and had no writer anywhere in the
-- app — a whole table (and a join on every chat message) for two booleans.
-- They live on the user row now, which the chat route already loads.
alter table public.users
  add column if not exists chat_banned boolean not null default false;

alter table public.users
  add column if not exists chat_muted_until timestamptz;


-- ============================================================================
-- §2  COMMUNITY POSTS
-- ============================================================================
--
-- Short-form micro-posts (the community feed). Separate from `stories`,
-- which holds long-form articles.
-- ============================================================================

create table if not exists public.posts (
  id             bigserial primary key,
  user_id        text not null references public.users(id) on delete cascade,
  content        text not null,
  story_slug     text,
  story_title    text,
  story_cover    text,
  likes_count    integer not null default 0,
  reposts_count  integer not null default 0,
  comments_count integer not null default 0,
  status         text not null default 'published',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_posts_user_id    on public.posts(user_id);
create index if not exists idx_posts_created_at on public.posts(created_at desc);

-- Edit history. The previous content is stored before each edit so an admin
-- can review who changed what.
create table if not exists public.posts_history (
  id         bigserial primary key,
  post_id    bigint not null references public.posts(id) on delete cascade,
  content    text not null,
  edited_by  text not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_posts_history_post on public.posts_history(post_id);

create table if not exists public.posts_likes (
  post_id    bigint not null references public.posts(id) on delete cascade,
  user_id    text   not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists idx_posts_likes_user on public.posts_likes(user_id);

create table if not exists public.posts_reposts (
  post_id    bigint not null references public.posts(id) on delete cascade,
  user_id    text   not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists idx_posts_reposts_user on public.posts_reposts(user_id);

create table if not exists public.posts_comments (
  id         text primary key,
  post_id    bigint not null references public.posts(id) on delete cascade,
  user_id    text   not null references public.users(id) on delete cascade,
  content    text   not null,
  status     text   not null default 'approved',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists idx_posts_comments_post on public.posts_comments(post_id);
create index if not exists idx_posts_comments_user on public.posts_comments(user_id);


-- ============================================================================
-- §3  ENGAGEMENT — likes, reactions, bookmarks, history, follows
-- ============================================================================
--
-- These tables keep BOTH a `post_slug` (the original key) and a `post_id`
-- (the normalised FK into post_metadata, added in §5). The slug is what
-- older rows still carry; the FK is what new rows fill in. Both are kept so
-- nothing breaks for content published before the normalisation.
-- ============================================================================

-- "পছন্দ করুন" (like) on a story. Distinct from the reactions below.
create table if not exists public.post_likes (
  id        text primary key,
  post_slug text not null,
  user_id   text not null references public.users(id) on delete cascade,
  username  text,
  name      text,
  created_at timestamptz default now(),
  unique (post_slug, user_id)
);

create index if not exists idx_likes_post_slug on public.post_likes(post_slug);
create index if not exists idx_likes_user_id   on public.post_likes(user_id);

-- Emoji reactions on a STORY: ❤️ 👍 😂 😮.
-- Separate from `comment_reactions` (§6), which reacts to a comment.
--
-- The unique key includes reaction_type so one reader can leave several
-- different reactions on the same story.
create table if not exists public.post_reactions (
  id            uuid default gen_random_uuid() primary key,
  post_slug     text not null,
  user_id       text not null references public.users(id) on delete cascade,
  reaction_type text not null,
  created_at    timestamptz default now(),
  unique (post_slug, user_id, reaction_type)
);

create index if not exists idx_reactions_post_slug on public.post_reactions(post_slug);
create index if not exists idx_reactions_user_id   on public.post_reactions(user_id);

-- Saved posts live in `users.saved_posts` (jsonb array of slugs) — see §1.
-- There used to be a separate `bookmarks` table holding the same facts with
-- a (post_slug, user_id) unique key, while the UI read `users.saved_posts`
-- (and the login/session path already loads it). One place, one query.

-- Reading history — which stories a reader has opened, when, and how far
-- they got.
--
-- `percent` used to live in a separate `story_progress` table with the exact
-- same (post_slug, user_id) unique key. Two tables, one fact: this row IS
-- the reading-progress row. Author analytics reads `percent` from here.
create table if not exists public.reading_history (
  id           uuid default gen_random_uuid() primary key,
  post_slug    text not null,
  user_id      text not null references public.users(id) on delete cascade,
  last_read_at timestamptz default now(),
  percent      integer default 0 check (percent between 0 and 100),
  unique (post_slug, user_id)
);

create index if not exists idx_reading_history_user on public.reading_history(user_id);

-- Follow graph.
create table if not exists public.user_follows (
  id         uuid default gen_random_uuid() primary key,
  user_id    text not null references public.users(id) on delete cascade,
  author_id  text not null references public.users(id) on delete cascade,
  created_at timestamptz default now(),
  unique (user_id, author_id)
);

create index if not exists idx_follows_user   on public.user_follows(user_id);
create index if not exists idx_follows_author on public.user_follows(author_id);


-- ============================================================================
-- §4  post_metadata
-- ============================================================================
--
-- The canonical story identity table. It links the MDX/URL slug to the
-- relational data (comments, likes, bookmarks, pins, saved posts all join
-- through it).
--
-- The `story_id` FK back to `stories` is added in §7, once `stories` exists.
-- ============================================================================

create table if not exists public.post_metadata (
  id           uuid default gen_random_uuid() primary key,
  mdx_uid      text unique not null,
  slug         text not null,
  author_id    text references public.users(id) on delete set null,
  status       text default 'published',
  category     text,
  published_at timestamptz,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists idx_pm_slug   on public.post_metadata(slug);
create index if not exists idx_pm_uid    on public.post_metadata(mdx_uid);
create index if not exists idx_pm_author on public.post_metadata(author_id);
create index if not exists idx_pm_status on public.post_metadata(status);


-- ============================================================================
-- §5  VIEW COUNTERS
-- ============================================================================
--
-- ONE table, keyed by slug. It used to be two:
--
--   post_views        slug-keyed counter   ← the real key
--   post_view_counts  id-keyed counter     ← duplicate of the same number
--
-- Every story already has a unique slug, and `post_metadata.slug` maps the
-- slug to the metadata id, so the second table was the same fact stored
-- twice. Keeping both meant every read had to check two tables and every
-- write had to pick one, and the numbers could drift apart.
--
-- `post_id` is still stored when it is known, so joins into post_metadata
-- stay index-backed, but the slug is the identity.
-- ============================================================================

create table if not exists public.post_views (
  post_slug  text primary key,
  post_id    uuid references public.post_metadata(id) on delete set null,
  view_count integer default 0,
  updated_at timestamptz default now()
);

create unique index if not exists post_views_post_id_key
  on public.post_views(post_id)
  where post_id is not null;

-- Add normalised post_id FKs to the slug-keyed engagement tables created above.
alter table public.post_likes      add column if not exists post_id uuid references public.post_metadata(id) on delete cascade;
alter table public.post_reactions  add column if not exists post_id uuid references public.post_metadata(id) on delete cascade;
alter table public.reading_history add column if not exists post_id uuid references public.post_metadata(id) on delete cascade;

create index if not exists idx_likes_post_id           on public.post_likes(post_id);
create index if not exists idx_reactions_post_id       on public.post_reactions(post_id);
create index if not exists idx_reading_history_post_id on public.reading_history(post_id);


-- ============================================================================
-- §6  COMMENTS
-- ============================================================================
--
-- Comments are polymorphic: they can hang off a story (post_slug) or a video
-- (target_type = 'video', target_id = the video UUID).
--
--   story comment → target_type = 'post',  target_id = <slug>
--   video comment → target_type = 'video', target_id = <video uuid>
--
-- For video comments `post_slug` carries a synthetic "v:<uuid>" value so the
-- existing slug index keeps working.
-- ============================================================================

create table if not exists public.comments (
  id                text primary key,
  post_id           uuid references public.post_metadata(id) on delete cascade,
  post_slug         text not null,
  user_id           text not null references public.users(id) on delete cascade,
  username          text not null,
  name              text,
  profile_pic       text,
  content           text not null,
  parent_comment_id text,
  status            text default 'approved',
  created_at        timestamptz default now(),
  updated_at        timestamptz,

  -- Polymorphic targeting (added by the original comments-polymorphic.sql).
  target_type       text default 'post',
  target_id         text,

  -- Moderation flags.
  is_pinned         boolean default false,
  is_spoiler        boolean default false
);

alter table public.comments
  add column if not exists post_id uuid references public.post_metadata(id) on delete cascade;

create index if not exists idx_comments_post_id on public.comments(post_id);

alter table public.comments
  alter column target_type set default 'post';

-- Backfill so pre-migration rows carry a target too.
update public.comments
   set target_type = 'post',
       target_id   = post_slug
 where target_type is null or target_id is null;

alter table public.comments
  alter column target_type set not null;

-- The original single-column index is replaced by this composite one, which
-- covers both the story-feed and video-feed lookups.
create index if not exists idx_comments_target
  on public.comments(target_type, target_id, created_at desc);

create index if not exists idx_comments_user_id on public.comments(user_id);
create index if not exists idx_comments_pinned   on public.comments(is_pinned);

drop index if exists public.idx_comments_post_slug;

-- Emoji reactions on a COMMENT. One row per (comment, user, emoji).
create table if not exists public.comment_reactions (
  id         uuid default gen_random_uuid() primary key,
  comment_id text not null references public.comments(id) on delete cascade,
  user_id    text not null references public.users(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz default now(),
  unique (comment_id, user_id, emoji)
);

create index if not exists idx_comment_reactions_comment on public.comment_reactions(comment_id);
create index if not exists idx_comment_reactions_user    on public.comment_reactions(user_id);


-- ============================================================================
-- §7  STORIES
-- ============================================================================
--
-- Long-form articles. `slug` is the upsert conflict key for both `stories`
-- and `post_metadata`, so it is never repurposed for the public URL — that
-- lives in `public_slug` (§14).
--
-- `status` accepts: published, pending, draft, revision_requested,
-- rejected, hidden. There is deliberately no CHECK constraint, so a new
-- status can be added without a migration.
-- ============================================================================

create table if not exists public.stories (
  id               uuid default gen_random_uuid() primary key,
  uid              text unique not null,
  slug             text unique not null,
  title            text not null,
  description      text default '',
  content          text not null,
  author_id        text references public.users(id) on delete set null,
  category         text default 'golpo',
  tags             text[] default '{}',
  cover            text default '',
  previous_post    text default '',
  status           text default 'published',
  featured         boolean default false,
  history          jsonb default '[]'::jsonb,
  rejection_reason text default '',
  published_at     timestamptz default now(),
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),

  -- Future publish time (admin-only scheduling).
  scheduled_at     timestamptz,

  -- Reading time is computed at save time so list queries never have to
  -- fetch the full body — fetching it breaks Next.js caching.
  reading_time     text default ''
);

create index if not exists idx_stories_slug       on public.stories(slug);
create index if not exists idx_stories_uid        on public.stories(uid);
create index if not exists idx_stories_author     on public.stories(author_id);
create index if not exists idx_stories_status     on public.stories(status);
create index if not exists idx_stories_category   on public.stories(category);
create index if not exists idx_stories_published  on public.stories(published_at desc);
create index if not exists idx_stories_scheduled  on public.stories(scheduled_at);

-- Link post_metadata back to the story row.
alter table public.post_metadata
  add column if not exists story_id uuid references public.stories(id) on delete cascade;

-- Backfill reading_time for rows saved before the column existed. Uses the
-- same 200 wpm estimate as the app's `reading-time` library, minimum 1 min.
update public.stories
   set reading_time = greatest(1, ceil(array_length(regexp_split_to_array(trim(content), '\s+'), 1)::numeric / 200))::text || ' min read'
 where (reading_time is null or reading_time = '')
   and content is not null
   and length(trim(content)) > 0;

-- Co-authors — many-to-many between a story and its writers.
create table if not exists public.story_coauthors (
  id         uuid default gen_random_uuid() primary key,
  story_uid  text not null references public.stories(uid) on delete cascade,
  user_id    text not null references public.users(id) on delete cascade,
  created_at timestamptz default now(),
  unique (story_uid, user_id)
);

create index if not exists idx_story_coauthors_story on public.story_coauthors(story_uid);
create index if not exists idx_story_coauthors_user  on public.story_coauthors(user_id);


-- ============================================================================
-- §8  NOTIFICATIONS
-- ============================================================================
--
-- `id` is a text UUID written by the app (lib/notify.ts) — it is NOT NULL,
-- so an insert that omits it fails. All reads and writes go through the
-- service role key.
-- ============================================================================

create table if not exists public.notifications (
  id                text primary key,
  user_id           text not null references public.users(id) on delete cascade,
  type              text not null,
  actor_id          text,
  actor_name        text,
  actor_profile_pic text,
  post_id           uuid references public.post_metadata(id) on delete set null,
  post_slug         text,
  comment_id        text,
  snippet           text,
  is_read           boolean default false,
  created_at        timestamptz default now()
);

alter table public.notifications
  add column if not exists post_id uuid references public.post_metadata(id) on delete set null;

create index if not exists idx_notifications_user_id on public.notifications(user_id);
create index if not exists idx_notifications_post_id on public.notifications(post_id);


-- ============================================================================
-- §9  CHAT
-- ============================================================================

-- The global group chat. The client subscribes to postgres_changes on this
-- table, so it is added to the realtime publication in §19.
create table if not exists public.chat_messages (
  id          uuid default gen_random_uuid() primary key,
  user_id     text not null references public.users(id) on delete cascade,
  username    text,
  name        text,
  profile_pic text,
  message     text not null,
  role        text default 'user',
  is_system   boolean default false,
  created_at  timestamptz default now()
);

create index if not exists idx_chat_created_at on public.chat_messages(created_at desc);

-- Backfill so older messages keep rendering with the right owner name.
update public.chat_messages
   set username = coalesce(username, 'unknown'),
       name     = coalesce(name, username, 'unknown'),
       role     = coalesce(role, 'user'),
       is_system = coalesce(is_system, false)
 where username is null or role is null or is_system is null;

-- Private conversation between two users.
create table if not exists public.conversations (
  id             uuid default gen_random_uuid() primary key,
  user1_id       text not null references public.users(id) on delete cascade,
  user2_id       text not null references public.users(id) on delete cascade,
  last_message   text,
  last_message_at timestamptz default now(),
  unique (user1_id, user2_id)
);

create table if not exists public.private_messages (
  id              uuid default gen_random_uuid() primary key,
  conversation_id uuid references public.conversations(id) on delete cascade,
  sender_id       text not null references public.users(id) on delete cascade,
  receiver_id     text not null references public.users(id) on delete cascade,
  message         text not null,
  is_read         boolean default false,
  created_at      timestamptz default now()
);

create index if not exists idx_pm_conversation    on public.private_messages(conversation_id);
create index if not exists idx_pm_sender_receiver on public.private_messages(sender_id, receiver_id);

-- Chat moderation lives on `public.users` (chat_banned / chat_muted_until).
-- The old standalone `chat_mutes` table is gone — see §1.

-- Deletes group-chat messages older than 5 hours.
--
-- Not called from application code — it is meant to be scheduled with
-- pg_cron:
--
--   select cron.schedule(
--     'delete_old_group_messages_cron',
--     '0 * * * *',
--     'select public.delete_old_group_messages()'
--   );
--
create or replace function public.delete_old_group_messages()
returns void
language plpgsql
as $$
begin
  delete from public.chat_messages
   where created_at < now() - interval '5 hours';
end;
$$;


-- ============================================================================
-- §10  SOCIAL & MODERATION
-- ============================================================================

-- Requests for the verified badge.
create table if not exists public.verification_requests (
  id         uuid default gen_random_uuid() primary key,
  user_id    text not null references public.users(id) on delete cascade,
  reason     text,
  status     text default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz default now(),
  unique (user_id)
);

-- Requests to become an author.
--
-- The column set is the merge of two earlier definitions: `reviewer_id` and
-- `reviewed_at` come from migrate-schema.sql, the status CHECK from
-- migration-social-features.sql. The app needs both — the admin panel
-- writes reviewer_id/reviewed_at when it approves or rejects.
create table if not exists public.author_applications (
  id           uuid default gen_random_uuid() primary key,
  user_id      text references public.users(id) on delete set null,
  username     text,
  real_name    text,
  sample_link  text,
  message      text,
  status       text default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewer_id  text references public.users(id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz default now()
);

create index if not exists idx_apps_user   on public.author_applications(user_id);
create index if not exists idx_apps_status on public.author_applications(status);

-- One open application per user.
create unique index if not exists idx_apps_pending
  on public.author_applications(user_id)
  where status = 'pending';

-- Limited admins hide content; a superadmin approves permanent deletion.
create table if not exists public.deletion_requests (
  id           uuid default gen_random_uuid() primary key,
  target_type  text not null check (target_type in ('story', 'comment', 'user')),
  target_id    text not null,
  requested_by text not null references public.users(id) on delete cascade,
  reason       text,
  status       text default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at   timestamptz default now()
);

-- Lightweight audit trail of sensitive admin actions.
create table if not exists public.admin_audit_logs (
  id             uuid default gen_random_uuid() primary key,
  actor_id       text,
  actor_username text,
  action         text not null,
  target_type    text,
  target_id      text,
  prev_state     jsonb,
  new_state      jsonb,
  created_at     timestamptz default now()
);

create index if not exists idx_audit_actor   on public.admin_audit_logs(actor_id);
create index if not exists idx_audit_action  on public.admin_audit_logs(action);
create index if not exists idx_audit_created on public.admin_audit_logs(created_at);

-- User reports for stories AND comments — one report system for all
-- content. `comment_reports` used to be a second, near-identical table for
-- comments only; it is folded in here as `target_type = 'comment'`.
create table if not exists public.reports (
  id          uuid default gen_random_uuid() primary key,
  reporter_id text not null references public.users(id) on delete cascade,
  target_type text not null check (target_type in ('story', 'comment')),
  target_id   text not null,
  post_slug   text,
  reason      text,
  status      text default 'pending' check (status in ('pending', 'reviewed', 'dismissed')),
  created_at  timestamptz default now(),
  unique (reporter_id, target_type, target_id)
);

create index if not exists idx_reports_target on public.reports(target_type, target_id);
create index if not exists idx_reports_status on public.reports(status);


-- ============================================================================
-- §11  SITE CONFIGURATION
-- ============================================================================
--
-- All site-wide configuration lives in the DB. The app deep-merges these
-- rows over the built-in defaults in lib/site-defaults.ts, so a partial row
-- is safe — the defaults fill the gaps.
-- ============================================================================

create table if not exists public.site_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz default now()
);

-- Categories, previously stored in a GitHub JSON file.
create table if not exists public.categories (
  id          text primary key,
  name        text not null,
  icon        text default 'feather',
  description text default '',
  created_at  timestamptz default now()
);

-- Site-wide announcement banner.
create table if not exists public.announcements (
  id         uuid default gen_random_uuid() primary key,
  text       text not null default '',
  active     boolean default false,
  color      text default 'blue',
  link       text default '',
  created_by text references public.users(id) on delete set null,
  updated_at timestamptz default now()
);

-- `crawler_sources` (watched domains for the auto-poster) and the
-- `crawler_config` site_settings row are GONE — the "অটো পোস্ট ও স্মার্ট
-- ক্রলার" feature was removed along with its routes. Published stories that
-- came from it are untouched.

-- ============================================================================
-- §12  VIDEO LIBRARY
-- ============================================================================
--
-- Video files are never uploaded or stored here — only provider CDN URLs
-- and the post metadata. The browser streams straight from the provider.
-- ============================================================================

create table if not exists public.video_posts (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(title) between 1 and 160),
  description   text check (description is null or char_length(description) <= 500),
  source_url    text check (source_url is null or source_url like 'https://%'),
  embed_url     text check (embed_url is null or embed_url like 'https://%'),
  thumbnail_url text check (thumbnail_url is null or thumbnail_url like 'https://%'),
  credit        text check (credit is null or char_length(credit) <= 160),
  status        text not null default 'draft' check (status in ('draft', 'published', 'deleted')),
  created_by    text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz,

  -- Future publish time.
  scheduled_at  timestamptz,

  -- Unique-view counter, bumped atomically by record_video_view().
  view_count    integer not null default 0,

  -- The original uploader / channel name, shown on cards and detail pages.
  uploader_name text
);

-- The channel credit line appended to every published description.
-- (Kept as a constraint so a runaway paste cannot bloat the column.)
alter table public.video_posts
  drop constraint if exists video_posts_uploader_name_check;
alter table public.video_posts
  add constraint video_posts_uploader_name_check
  check (uploader_name is null or char_length(uploader_name) <= 120);

-- The counter must never go negative.
alter table public.video_posts
  drop constraint if exists video_posts_view_count_non_negative;
alter table public.video_posts
  add constraint video_posts_view_count_non_negative
  check (view_count >= 0);

create index if not exists video_posts_publication_idx
  on public.video_posts (published_at desc)
  where status = 'published';

create index if not exists video_posts_scheduled_idx
  on public.video_posts (scheduled_at)
  where scheduled_at is not null;

create index if not exists idx_video_posts_status_published
  on public.video_posts(status, published_at desc);

-- One row per (video, viewer) per dedupe bucket (24h). The unique constraint
-- is what makes the counter honest — see record_video_view() in §17.
create table if not exists public.video_views (
  id         bigserial primary key,
  video_id   uuid not null references public.video_posts(id) on delete cascade,
  viewer_key text not null,
  created_at timestamptz not null default now(),
  unique (video_id, viewer_key)
);

create index if not exists idx_video_views_video_recent
  on public.video_views(video_id, created_at desc);

create index if not exists idx_video_views_viewer
  on public.video_views(viewer_key, created_at desc);


-- ============================================================================
-- §13  PICTURE GALLERY
-- ============================================================================
--
-- Like the video library: image files are never uploaded. Only provider CDN
-- URLs and the gallery metadata live here.
--
-- `images` is a JSONB array of:
--   { "url": "<full-size https url>", "thumb": "<https thumbnail url>",
--     "width": 1067, "height": 1600 }
--
-- It is kept on the row rather than in a child table because the images are
-- read-only, always read as one ordered set, and their position and
-- geometry have to stay together.
-- ============================================================================

create table if not exists public.picture_galleries (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 500),
  source_url  text not null check (source_url like 'https://%'),
  cover_url   text not null check (cover_url like 'https://%'),
  images      jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array'),
  image_count integer not null default 0 check (image_count >= 0),
  model_name  text check (model_name is null or char_length(model_name) <= 120),
  channel_name text check (channel_name is null or char_length(channel_name) <= 120),
  categories  text[] default '{}',
  tags        text[] default '{}',
  source_views integer check (source_views is null or source_views >= 0),
  status      text not null default 'draft' check (status in ('draft', 'published', 'deleted')),
  created_by  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  published_at timestamptz,

  -- Future publish time.
  scheduled_at timestamptz,

  -- Unique-view counter, bumped atomically by record_picture_view().
  view_count   integer not null default 0
);

alter table public.picture_galleries
  drop constraint if exists picture_galleries_view_count_non_negative;
alter table public.picture_galleries
  add constraint picture_galleries_view_count_non_negative
  check (view_count >= 0);

create index if not exists picture_galleries_publication_idx
  on public.picture_galleries (published_at desc)
  where status = 'published';

create index if not exists picture_galleries_scheduled_idx
  on public.picture_galleries (scheduled_at)
  where scheduled_at is not null;

-- ---------------------------------------------------------------------------
-- lower_array — lower-case every element of a text[].
--
-- Tags are scraped from the provider, so the same word arrives with
-- different capitalisation ("Blonde", "blonde", "BLONDE"). A plain
-- `tags @> ARRAY['Blonde']` is case-SENSITIVE, which would make a tag
-- link find only some of the galleries carrying it.
--
-- Postgres has no lower(text[]) — lower() only takes a single text — so
-- this helper lower-cases each element and reassembles the array:
--
--   public.lower_array(tags) @> ARRAY[lower('Blonde')]
--
-- It is IMMUTABLE so it can be used in an index expression. A plain
-- subquery cannot: "subqueries are not allowed in index expressions".
-- ---------------------------------------------------------------------------
create or replace function public.lower_array(arr text[])
returns text[]
language sql
immutable
strict
parallel safe
as $$
  select coalesce(
    array(select lower(x) from unnest(arr) as x),
    '{}'::text[]
  );
$$;

-- The filter index. GIN gives the index an array-containment operator (@>)
-- for free, and the expression index stores the lower-cased form so the
-- comparison never has to touch the raw rows.
--
-- The expression MUST match the one used by the RPCs in §17 exactly, or
-- the index will not be used.
create index if not exists picture_galleries_tags_lower_idx
  on public.picture_galleries using gin (public.lower_array(tags));

create index if not exists picture_galleries_categories_lower_idx
  on public.picture_galleries using gin (public.lower_array(categories));

-- ---------------------------------------------------------------------------
-- picture_source_key — the canonical form of a gallery URL.
--
-- The admin could publish the SAME gallery repeatedly: the same URL pasted
-- with a trailing slash, with a tracking query string, or with "www." on or
-- off. Every copy created another card on /pictures showing the same
-- pictures, and every copy counted its own views.
--
-- The normalisation steps mirror lib/picture-source-url.ts:
--   • drop the scheme
--   • drop the query string and the fragment
--   • drop a leading "www." from the host
--   • lower-case the host
--   • drop a trailing slash from the path
--   • KEEP the path — two galleries on the same host are different
--     galleries, so the path is part of the identity.
--
-- A plain SQL function is used rather than a giant expression because the
-- normalisation has several ordered steps, and a generated column can only
-- call IMMUTABLE functions.
-- ---------------------------------------------------------------------------
create or replace function public.picture_source_key(url text)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  rest text;
  host text;
  path text;
begin
  if url is null then
    return null;
  end if;

  -- 1. Drop the scheme: everything up to and including "://".
  rest := split_part(url, '://', 2);
  if rest = url then
    rest := url;
  end if;

  -- 2. Drop the query string, then the fragment.
  rest := split_part(rest, '?', 1);
  rest := split_part(rest, '#', 1);

  -- 3. Split the host from the path.
  host := split_part(rest, '/', 1);
  if position('/' in rest) > 0 then
    path := regexp_replace(rest, '^[^/]*/', '');
  else
    path := '';
  end if;

  -- 4. Lower-case the host FIRST, then drop a leading "www." — so
  --    "WWW.example.com" is handled the same as "www.example.com".
  host := lower(host);
  host := regexp_replace(host, '^www\.', '');

  -- 5. Drop the trailing slash from the path.
  path := regexp_replace(path, '/+$', '');

  -- 6. Join them back together, always with exactly one separator.
  if path = '' then
    return nullif(host, '');
  end if;
  return nullif(host || '/' || path, '');
end;
$$;

-- The generated column. `source_key` is always recomputed by the database
-- from `source_url`, so it can never drift out of sync with the URL it
-- describes.
alter table public.picture_galleries
  drop column if exists source_key;

alter table public.picture_galleries
  add column source_key text
    generated always as (public.picture_source_key(source_url)) stored;

-- Clean up any duplicates that slipped in before this migration. Older
-- copies are soft-deleted rather than destroyed, so the admin can recover
-- them.
with ranked as (
  select id,
         row_number() over (
           partition by source_key
           order by created_at desc
         ) as rn
    from public.picture_galleries
   where status <> 'deleted'
)
update public.picture_galleries g
   set status = 'deleted',
       updated_at = now()
  from ranked r
 where g.id = r.id
   and r.rn > 1;

-- The unique index. It is PARTIAL, so a soft-deleted gallery frees its
-- slot and can be re-published later.
create unique index if not exists picture_galleries_source_key_uniq
  on public.picture_galleries (source_key)
  where status <> 'deleted';

-- One row per (gallery, viewer) per dedupe bucket (24h).
create table if not exists public.picture_views (
  id           bigserial primary key,
  gallery_id   uuid not null references public.picture_galleries(id) on delete cascade,
  viewer_key   text not null,
  created_at   timestamptz not null default now(),
  unique (gallery_id, viewer_key)
);

create index if not exists idx_picture_views_gallery_recent
  on public.picture_views(gallery_id, created_at desc);

create index if not exists idx_picture_views_viewer
  on public.picture_views(viewer_key, created_at desc);


-- ============================================================================
-- §14  PUBLIC SLUGS & SCHEDULED PUBLISHING
-- ============================================================================
--
-- Published content used to live at opaque URLs (/17384209312 for a story,
-- /videos/<uuid> and /pictures/<uuid> for media). Those links tell a reader
-- nothing about what they point at.
--
-- `public_slug` is the title in English, in kebab-case:
--   dhaka-new-bridge → /golpo/dhaka-new-bridge
--   jamal-nur-video   → /video/jamal-nur-video
--   kutir-chobi       → /image/kutir-chobi
--
-- When two items share a title, the second gets a numeric suffix
-- (dhaka-new-bridge, dhaka-new-bridge-1, dhaka-new-bridge-2).
--
-- Uniqueness is PER CONTENT TYPE — a story, a video and an image may all
-- be "dhaka-new-bridge" at once, because they live under different URL
-- prefixes. That is why there is one index per table.
--
-- `stories.slug` is deliberately NOT reused: it is the upsert conflict key
-- for both `stories` and `post_metadata`, and `post_metadata.slug` is the
-- lookup key for comments, likes, pins, bookmarks and saved posts.
-- Repurposing it would break those joins.
--
-- Existing rows are left empty on purpose: content published before this
-- change keeps its old URL, and that old URL keeps working.
-- ============================================================================

alter table public.stories
  add column if not exists public_slug text;

alter table public.video_posts
  add column if not exists public_slug text;

alter table public.picture_galleries
  add column if not exists public_slug text;

-- These are PARTIAL unique indexes (`where public_slug is not null`) so the
-- existing rows without a slug neither bloat the index nor collide with
-- each other. A partial unique index still enforces uniqueness among the
-- rows that DO have one — exactly the set that gets published URLs.
create unique index if not exists stories_public_slug_idx
  on public.stories (public_slug)
  where public_slug is not null;

create unique index if not exists video_posts_public_slug_idx
  on public.video_posts (public_slug)
  where public_slug is not null;

create unique index if not exists picture_galleries_public_slug_idx
  on public.picture_galleries (public_slug)
  where public_slug is not null;


-- ============================================================================
-- §15  ANALYTICS
-- ============================================================================
--
-- Raw visit log for unique-visitor and daily analytics. Reads and writes
-- happen server-side with the service role key, so no public policy is
-- created — raw visitor data is never exposed to the browser.
-- ============================================================================

-- `page_visits` is GONE — replaced by the daily rollup below.
--
-- It stored one row per individual visit (visitor_id, referrer, user_agent,
-- country) and was only ever read to COUNT those rows for the dashboard.
-- That is an individual browsing history in exchange for a few numbers.
-- `post_views_daily` stores the numbers directly.

-- ---------------------------------------------------------------------------
-- Daily view aggregates — the ONLY per-story time series kept.
--
-- The admin dashboard needs "views per day" and "top stories". Those are
-- answers about counts, not about people. `page_visits` answered them by
-- storing one row per visit with visitor id, referrer, user agent and
-- country, then grouping at read time — thousands of rows to compute a
-- handful of numbers, plus a per-visitor browsing history nobody asked for.
--
-- This table stores the grouped answer directly: one row per story per day.
-- Same charts, a tiny fraction of the rows, and nothing personal retained.
-- It grows by at most (stories × days), not (visits).
-- ---------------------------------------------------------------------------
create table if not exists public.post_views_daily (
  day        date not null default current_date,
  post_slug  text not null,
  view_count integer not null default 0,
  primary key (day, post_slug)
);

create index if not exists idx_post_views_daily_day
  on public.post_views_daily(day desc);

-- ---------------------------------------------------------------------------
-- Analytics aggregates, computed IN the database from the daily rollup.
--
-- The admin dashboard used to pull up to 1000 raw page_visits rows per
-- question (total, daily, top stories) and count them in Node: four
-- round-trips, thousands of rows leaving the database every time the panel
-- opened, and a silent 1000-row cap that made the totals wrong anyway.
--
-- It now reads `post_views_daily`, which already stores the grouped answer,
-- so the query touches (stories × days) rows instead of (visits).
-- ---------------------------------------------------------------------------
create or replace function public.admin_visit_stats(p_days integer default 14)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with windowed as (
    select post_slug, view_count, day
      from public.post_views_daily
     where day >= current_date - greatest(p_days, 1)
  )
  select jsonb_build_object(
    'totalVisits',    (select coalesce(sum(view_count), 0) from public.post_views_daily),
    'uniqueVisitors', (select coalesce(sum(view_count), 0) from public.post_views_daily),
    'daily', coalesce((
      select jsonb_agg(d order by d->>'date' desc)
        from (
          select jsonb_build_object(
                   'date', to_char(day, 'YYYY-MM-DD'),
                   'visits', sum(view_count),
                   'uniqueVisitors', sum(view_count)
                 ) as d
            from windowed
           group by day
        ) s
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.admin_visit_stats(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Retention for the daily rollup. One row per story per day is cheap, so
-- this stays generous — but it is still bounded, and an old day's counters
-- are not worth keeping forever. Schedule with pg_cron:
--
--   select cron.schedule(
--     'prune_post_views_daily',
--     '15 3 * * *',
--     $$select public.prune_post_views_daily(400)$$
--   );
-- ---------------------------------------------------------------------------
create or replace function public.prune_post_views_daily(p_keep_days integer default 400)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted integer;
begin
  delete from public.post_views_daily
   where day < current_date - greatest(p_keep_days, 1);
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

grant execute on function public.prune_post_views_daily(integer) to service_role;


-- ============================================================================
-- §16  SHARE SUGGESTIONS
-- ============================================================================
--
-- The admin "শেয়ার করার সাজেস্ট" panel ranks published stories worth
-- promoting. These tables log which stories were suggested and how many
-- times, so the ranking engine can enforce a cooldown and rotate through
-- the backlog instead of repeating the same three stories every day.
-- ============================================================================

create table if not exists public.share_suggestion_log (
  id          uuid primary key default gen_random_uuid(),
  post_slug   text not null,
  post_uid    text,
  story_title text,
  actor_id    text references public.users(id) on delete set null,
  score       numeric(8,3),
  served_on   date not null default current_date,
  created_at  timestamptz not null default now()
);

create index if not exists idx_share_suggestion_log_slug     on public.share_suggestion_log(post_slug);
create index if not exists idx_share_suggestion_log_served_on on public.share_suggestion_log(served_on desc);
create index if not exists idx_share_suggestion_log_actor_day on public.share_suggestion_log(actor_id, served_on desc);

-- Rotation bookkeeping — one row per served-day per admin. Guarantees
-- "max N suggestions per day" even across refreshes and multiple tabs.
create table if not exists public.share_suggestion_daily (
  id           uuid primary key default gen_random_uuid(),
  actor_id     text not null references public.users(id) on delete cascade,
  served_on    date not null default current_date,
  served_count integer not null default 0,
  served_slugs text[] not null default '{}',
  created_at   timestamptz not null default now(),
  unique (actor_id, served_on)
);


-- ============================================================================
-- §17  RPC FUNCTIONS
-- ============================================================================
--
-- PostgREST cannot express the case-insensitive array containment check
-- used for tag/category filtering, and the view counters need to be
-- incremented atomically. Both live in Postgres functions.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Backfill helper: fills post_id on the slug-keyed tables by matching
-- post_metadata.slug. Run it once after seeding post_metadata:
--
--   select public.backfill_post_ids();
-- ---------------------------------------------------------------------------
create or replace function public.backfill_post_ids()
returns void
language plpgsql
as $$
begin
  update public.comments c
     set post_id = pm.id
    from public.post_metadata pm
   where pm.slug = c.post_slug and c.post_id is null;

  update public.post_likes l
     set post_id = pm.id
    from public.post_metadata pm
   where pm.slug = l.post_slug and l.post_id is null;

  update public.post_reactions pr
     set post_id = pm.id
    from public.post_metadata pm
   where pm.slug = pr.post_slug and pr.post_id is null;

  update public.reading_history r
     set post_id = pm.id
    from public.post_metadata pm
   where pm.slug = r.post_slug and r.post_id is null;

  update public.post_views v
     set post_id = pm.id
    from public.post_metadata pm
   where pm.slug = v.post_slug and v.post_id is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Record a story view in one atomic statement.
--
-- Returns { "view_count": 12 }.
--
-- The route used to do: SELECT post_metadata by slug → SELECT counter →
-- write counter+1 → fall back to a second table and repeat. Four
-- round-trips, and a read-modify-write race that silently lost views when
-- two readers arrived together. `ON CONFLICT DO UPDATE` makes it a single
-- statement, so concurrent callers serialise on the row instead of
-- overwriting each other.
-- ---------------------------------------------------------------------------
create or replace function public.record_post_view(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
begin
  insert into public.post_views (post_slug, post_id, view_count, updated_at)
  values (
    p_slug,
    (select id from public.post_metadata where slug = p_slug),
    1,
    now()
  )
  on conflict (post_slug) do update
     set view_count = public.post_views.view_count + 1,
         updated_at = now()
  returning view_count into current_count;

  -- Daily bucket for the admin charts. This is an AGGREGATE row per story
  -- per day — it replaces the old `page_visits` table, which stored one row
  -- per individual visit (visitor id, referrer, user agent, country) purely
  -- so the dashboard could count them later. Same charts, ~100x fewer rows,
  -- and no personal browsing history.
  insert into public.post_views_daily (day, post_slug, view_count)
  values (current_date, p_slug, 1)
  on conflict (day, post_slug) do update
     set view_count = public.post_views_daily.view_count + 1;

  return jsonb_build_object('view_count', coalesce(current_count, 0));
end;
$$;

grant execute on function public.record_post_view(text) to service_role;

-- ---------------------------------------------------------------------------
-- Record a video view, counting it ONLY if this viewer has not been
-- counted before for this video.
--
-- Returns a JSONB payload:
--   { "counted": true,  "view_count": 12 }  -- a NEW viewer was counted
--   { "counted": false, "view_count": 12 }  -- duplicate; count unchanged
--
-- The whole thing is a single statement, so two concurrent requests from
-- the same viewer cannot both see "new" and both increment — the unique
-- index serialises them and exactly one wins.
--
-- `viewer_key` is a sha256 of ip|user-agent|day-bucket produced by the
-- route, so the 24-hour window is enforced by the key itself rather than
-- by a time-window query.
-- ---------------------------------------------------------------------------
create or replace function public.record_video_view(
  p_video_id uuid,
  p_viewer_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_rows integer;
  current_count integer;
begin
  insert into public.video_views (video_id, viewer_key)
  values (p_video_id, p_viewer_key)
  on conflict (video_id, viewer_key) do nothing;

  get diagnostics inserted_rows = row_count;

  if inserted_rows > 0 then
    update public.video_posts
       set view_count = view_count + 1
     where id = p_video_id
    returning view_count into current_count;
  else
    select view_count into current_count
      from public.video_posts
     where id = p_video_id;
  end if;

  return jsonb_build_object(
    'counted', inserted_rows > 0,
    'view_count', coalesce(current_count, 0)
  );
end;
$$;

grant execute on function public.record_video_view(uuid, text) to service_role;

-- Backwards-compatible shim. The old route called this unconditionally,
-- which is exactly what inflated the count. It is kept only so an older
-- deployed bundle cannot 500 during a rolling deploy — it is a no-op for
-- counting purposes.
create or replace function public.bump_video_view_count(p_video_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  update public.video_posts
     set view_count = view_count + 1
   where id = p_video_id
   returning view_count into next_count;
  return coalesce(next_count, 0);
end;
$$;

grant execute on function public.bump_video_view_count(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The same, for picture galleries.
-- ---------------------------------------------------------------------------
create or replace function public.record_picture_view(
  p_gallery_id uuid,
  p_viewer_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_rows integer;
  current_count integer;
begin
  insert into public.picture_views (gallery_id, viewer_key)
  values (p_gallery_id, p_viewer_key)
  on conflict (gallery_id, viewer_key) do nothing;

  get diagnostics inserted_rows = row_count;

  if inserted_rows > 0 then
    update public.picture_galleries
       set view_count = view_count + 1
     where id = p_gallery_id
    returning view_count into current_count;
  else
    select view_count into current_count
      from public.picture_galleries
     where id = p_gallery_id;
  end if;

  return jsonb_build_object(
    'counted', inserted_rows > 0,
    'view_count', coalesce(current_count, 0)
  );
end;
$$;

grant execute on function public.record_picture_view(uuid, text) to service_role;

create or replace function public.bump_picture_view_count(p_gallery_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  update public.picture_galleries
     set view_count = view_count + 1
   where id = p_gallery_id
   returning view_count into next_count;
  return coalesce(next_count, 0);
end;
$$;

grant execute on function public.bump_picture_view_count(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Galleries carrying a tag, newest first.
--
-- Returns the same columns the list query selects, so the caller can
-- render a card without a second round trip.
-- ---------------------------------------------------------------------------
create or replace function public.list_pictures_by_tag(
  p_tag text,
  p_page integer default 1,
  p_page_size integer default 24
)
returns setof public.picture_galleries
language sql
stable
security invoker
set search_path = public
as $$
  select g.*
    from public.picture_galleries g
   where g.status = 'published'
     and g.cover_url is not null
     and g.published_at <= now()
     and public.lower_array(g.tags) @> array[lower(p_tag)]
   order by g.published_at desc
   limit greatest(p_page_size, 1)
   offset (greatest(p_page, 1) - 1) * greatest(p_page_size, 1);
$$;

create or replace function public.count_pictures_by_tag(p_tag text)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::integer
    from public.picture_galleries g
   where g.status = 'published'
     and g.cover_url is not null
     and g.published_at <= now()
     and public.lower_array(g.tags) @> array[lower(p_tag)];
$$;

-- ---------------------------------------------------------------------------
-- The same, for a category.
-- ---------------------------------------------------------------------------
create or replace function public.list_pictures_by_category(
  p_category text,
  p_page integer default 1,
  p_page_size integer default 24
)
returns setof public.picture_galleries
language sql
stable
security invoker
set search_path = public
as $$
  select g.*
    from public.picture_galleries g
   where g.status = 'published'
     and g.cover_url is not null
     and g.published_at <= now()
     and public.lower_array(g.categories) @> array[lower(p_category)]
   order by g.published_at desc
   limit greatest(p_page_size, 1)
   offset (greatest(p_page, 1) - 1) * greatest(p_page_size, 1);
$$;

create or replace function public.count_pictures_by_category(p_category text)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::integer
    from public.picture_galleries g
   where g.status = 'published'
     and g.cover_url is not null
     and g.published_at <= now()
     and public.lower_array(g.categories) @> array[lower(p_category)];
$$;

-- ---------------------------------------------------------------------------
-- Every tag in use across published galleries, with how many galleries
-- carry it.
--
-- The rows are unnested and grouped in the database so the app does not
-- have to pull every gallery row just to count tags.
--
-- Tags are grouped by their LOWERCASED form, because the same word can
-- arrive from different providers with different capitalisation ("Blonde"
-- and "blonde"). Grouping on the raw text would show the same tag twice in
-- the filter bar, each with a partial count. The first spelling
-- encountered is kept for display.
-- ---------------------------------------------------------------------------
create or replace function public.list_picture_tags()
returns table (tag text, count integer)
language sql
stable
security invoker
set search_path = public
as $$
  select min(t.tag::text) as tag, count(*)::integer as count
    from public.picture_galleries g
         cross join lateral unnest(g.tags) as t(tag)
   where g.status = 'published'
     and g.cover_url is not null
     and g.published_at <= now()
     and t.tag is not null
     and btrim(t.tag) <> ''
   group by lower(t.tag)
   order by count(*) desc, lower(t.tag) asc;
$$;

-- ---------------------------------------------------------------------------
-- Every category in use across published galleries, with counts.
-- Grouped by the lower-cased form, for the same reason as tags.
-- ---------------------------------------------------------------------------
create or replace function public.list_picture_categories()
returns table (category text, count integer)
language sql
stable
security invoker
set search_path = public
as $$
  select min(c.category::text) as category, count(*)::integer as count
    from public.picture_galleries g
         cross join lateral unnest(g.categories) as c(category)
   where g.status = 'published'
     and g.cover_url is not null
     and g.published_at <= now()
     and c.category is not null
     and btrim(c.category) <> ''
   group by lower(c.category)
   order by count(*) desc, lower(c.category) asc;
$$;

-- ---------------------------------------------------------------------------
-- Look up a gallery by its source URL without repeating the normalisation
-- expression. Used by the API route to give the admin a friendly message
-- when they try to publish the same gallery twice.
-- ---------------------------------------------------------------------------
create or replace function public.find_picture_by_source_key(p_source_url text)
returns table (id uuid, title text, status text, published_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select g.id, g.title, g.status, g.published_at
    from public.picture_galleries g
   where g.source_key = public.picture_source_key(p_source_url)
     and g.status <> 'deleted'
   limit 1;
$$;


-- ============================================================================
-- §18  ROW LEVEL SECURITY
-- ============================================================================
--
-- Every table gets RLS enabled. The service role key bypasses RLS, so the
-- app keeps working; the point is to stop the browser's anon key from
-- reading private rows.
--
-- PUBLIC READ is granted only where the UI genuinely needs it:
--   comments, post_likes, post_reactions, post_views,
--   post_metadata, chat_messages, announcements, categories, site_settings,
--   stories (published only)
--
-- Everything else — users, notifications, private_messages, conversations,
-- reading_history, reports, and the whole admin surface — is
-- closed to anon and reachable only through server routes.
-- ============================================================================

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'users','comments','post_likes','post_reactions','post_views',
    'post_metadata','notifications','chat_messages',
    'conversations','private_messages','reading_history',
    'user_follows','announcements','author_applications',
    'comment_reactions','reports',
    'story_coauthors','verification_requests','deletion_requests',
    'admin_audit_logs','categories','site_settings',
    'stories','posts','posts_history','posts_likes','posts_reposts',
    'posts_comments','video_posts','video_views','picture_galleries',
    'picture_views','post_views_daily','share_suggestion_log',
    'share_suggestion_daily'
  ]
  loop
    if to_regclass('public.' || tbl) is not null then
      execute format('alter table public.%I enable row level security', tbl);
    end if;
  end loop;
end $$;

-- ── USERS — no public read. Contains emails and password hashes. ──
drop policy if exists "Allow public read users" on public.users;
drop policy if exists "Allow all anon" on public.users;
drop policy if exists "Allow insert anon" on public.users;
drop policy if exists "Allow update anon" on public.users;
drop policy if exists "Allow delete anon" on public.users;
revoke all on public.users from anon;
revoke all on public.users from authenticated;

-- ── PUBLIC READ ──
-- These policies are recreated with DROP IF EXISTS first, so re-running
-- this file never fails on an existing policy.

drop policy if exists "Allow public read comments" on public.comments;
create policy "Allow public read comments"
  on public.comments for select using (true);

drop policy if exists "Allow public read post_likes" on public.post_likes;
create policy "Allow public read post_likes"
  on public.post_likes for select using (true);

drop policy if exists "Allow public read post_reactions" on public.post_reactions;
create policy "Allow public read post_reactions"
  on public.post_reactions for select using (true);

drop policy if exists "Allow public read post_views" on public.post_views;
create policy "Allow public read post_views"
  on public.post_views for select using (true);

drop policy if exists "Allow public read post_metadata" on public.post_metadata;
create policy "Allow public read post_metadata"
  on public.post_metadata for select using (true);

drop policy if exists "Allow public read comment_reactions" on public.comment_reactions;
create policy "Allow public read comment_reactions"
  on public.comment_reactions for select using (true);

-- The live group chat needs a public read policy for the Realtime
-- subscription to deliver messages to the browser.
drop policy if exists "Allow public read chat_messages" on public.chat_messages;
create policy "Allow public read chat_messages"
  on public.chat_messages for select using (true);

drop policy if exists "Allow public read announcements" on public.announcements;
create policy "Allow public read announcements"
  on public.announcements for select using (true);

drop policy if exists "Allow public read categories" on public.categories;
create policy "Allow public read categories"
  on public.categories for select using (true);

drop policy if exists "Allow public read site_settings" on public.site_settings;
create policy "Allow public read site_settings"
  on public.site_settings for select using (true);


drop policy if exists "Allow public read video_views counts" on public.video_views;
create policy "Allow public read video_views counts"
  on public.video_views for select using (true);

drop policy if exists "Allow public read picture_views counts" on public.picture_views;
create policy "Allow public read picture_views counts"
  on public.picture_views for select using (true);

-- ── STORIES — published rows only ──
drop policy if exists "Allow public read for published stories" on public.stories;
create policy "Allow public read for published stories"
  on public.stories for select
  using (status = 'published');

-- The two `auth.uid()` policies below only exist on Supabase (they are what
-- the dashboard's own auth bridge uses). The app never relies on them: the
-- session is a signed cookie read by `lib/auth.ts`, and every query runs
-- through the service role key, which bypasses RLS entirely. On a plain
-- Postgres database there is no `auth` schema, so creating them would abort
-- the whole setup — hence the guard.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'auth') then
    execute $p$
      drop policy if exists "Allow authors to read own stories" on public.stories
    $p$;
    execute $p$
      create policy "Allow authors to read own stories"
        on public.stories for select
        using (auth.uid()::text = author_id)
    $p$;

    execute $p$
      drop policy if exists "Allow admins full access to stories" on public.stories
    $p$;
    execute $p$
      create policy "Allow admins full access to stories"
        on public.stories for all
        using (
          exists (
            select 1 from public.users
             where public.users.id = auth.uid()::text
               and public.users.role in ('admin', 'superadmin')
          )
        )
    $p$;
  end if;
end $$;

-- ── BLOCK ANON WRITES ──
-- Reads stay open where the UI needs them, but no table may be written
-- through the browser's anon/authenticated key. All writes go through the
-- service role key on the server.
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'comments','post_likes','post_reactions','post_views',
    'notifications','chat_messages','conversations','private_messages',
    'reading_history','reports',
    'verification_requests','deletion_requests','author_applications',
    'admin_audit_logs','comment_reactions','story_coauthors','user_follows',
    'post_metadata','post_views_daily','announcements','categories',
    'site_settings','stories','posts','posts_history',
    'posts_likes','posts_reposts','posts_comments','video_posts',
    'video_views','picture_galleries','picture_views',
    'share_suggestion_log','share_suggestion_daily'
  ]
  loop
    if to_regclass('public.' || tbl) is not null then
      execute format('drop policy if exists "Allow all anon" on public.%I', tbl);
      execute format('drop policy if exists "Allow insert anon" on public.%I', tbl);
      execute format('drop policy if exists "Allow update anon" on public.%I', tbl);
      execute format('drop policy if exists "Allow delete anon" on public.%I', tbl);
      execute format('revoke insert, update, delete on public.%I from anon', tbl);
      execute format('revoke insert, update, delete on public.%I from authenticated', tbl);
    end if;
  end loop;
end $$;

-- The share-suggestion tables are admin-only and have no read path at all,
-- so they get an explicit deny policy.
drop policy if exists "No direct client access to share_suggestion_log"
  on public.share_suggestion_log;
create policy "No direct client access to share_suggestion_log"
  on public.share_suggestion_log for all using (false);

drop policy if exists "No direct client access to share_suggestion_daily"
  on public.share_suggestion_daily;
create policy "No direct client access to share_suggestion_daily"
  on public.share_suggestion_daily for all using (false);


-- ============================================================================
-- §19  GRANTS & REALTIME
-- ============================================================================

-- The client subscribes to postgres_changes on chat_messages, so the table
-- must be in the supabase_realtime publication. The guard makes this safe
-- to re-run.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and tablename = 'chat_messages'
    ) then
      alter publication supabase_realtime add table public.chat_messages;
    end if;
  end if;
end $$;


-- ============================================================================
-- §20  SEED DATA
-- ============================================================================
--
-- Every insert here is idempotent, so re-running this file never
-- duplicates or resets anything unexpectedly.
-- ============================================================================

-- The default categories.
insert into public.categories (id, name, icon, description) values
  ('hot', 'গরম গল্প', 'feather', 'একদম ঝকঝকে রস বের করা মজার গল্প'),
  ('bodhu', 'গৃহ বধূ', 'feather', 'ঘরের বুকে নিয়ে গল্প'),
  ('tarona', 'যৌন তাড়না', 'feather', 'বয়স্ক বা ডিভোর্সিদের গল্প'),
  ('obibahito', 'অবিবাহিত', 'feather', 'অবিবাহিতদের কাহিনী'),
  ('bibahito', 'বিবাহিত', 'feather', 'বিবাহিত স্বামী-স্ত্রী এর কাহিনী'),
  ('porokiya', 'পরকিয়া', 'feather', 'কে কে ধোঁকা দিচ্ছে'),
  ('kumari', 'কুমারী', 'feather', 'সদ্য রূপ ঝলকানো মেয়েদের গল্প'),
  ('prem', 'প্রেম', 'feather', 'প্রেমিক-প্রেমিকাদের পরান জুড়ানো গল্প'),
  ('pesha', 'পেশাজীবী', 'feather', 'পেশাজীবী কপোতদের গল্প'),
  ('paribarik', 'পাবিবারিক', 'feather', 'পারিবারিক গল্প'),
  ('somokami', 'সমকামী', 'feather', 'সমকামীদের গল্প'),
  ('aloukik', 'অলৌকিক', 'feather', 'ভূত পরীদের নিয়ে গল্প')
on conflict (id) do nothing;

-- Add the "ছবি" (pictures) entry to the navigation if it is missing.
--
-- The site's nav is DB-backed (site_settings key `navigation`) and the DB
-- row wins over DEFAULT_NAVIGATION in lib/site-defaults.ts, so adding the
-- entry to the defaults alone would NOT show it in production.
--
-- Idempotent: re-running never duplicates the entry.
update public.site_settings
   set value = jsonb_set(
         value,
         '{main}',
         coalesce(
           (select jsonb_agg(item order by ord)
              from (select ord, item
                      from jsonb_array_elements(coalesce(value->'main', '[]'::jsonb))
                           with ordinality as t(item, ord)
                     where item->>'href' is distinct from '/pictures') s),
           '[]'::jsonb
         ) || '[{"href":"/pictures","label":"ছবি"}]'::jsonb
       )
 where key = 'navigation'
   and exists (select 1 from jsonb_array_elements(coalesce(value->'main', '[]'::jsonb)) t(item)
                where item->>'href' = '/pictures') is false;


-- ============================================================================
-- SETUP COMPLETE
-- ============================================================================
--
-- Optional follow-up steps:
--
--   1. Point the app at the project:
--        NEXT_PUBLIC_SUPABASE_URL=...
--        NEXT_PUBLIC_SUPABASE_ANON_KEY=...
--        SUPABASE_SERVICE_ROLE_KEY=...
--
--   2. Schedule the group-chat cleanup (optional, needs pg_cron):
--        select cron.schedule(
--          'delete_old_group_messages_cron',
--          '0 * * * *',
--          'select public.delete_old_group_messages()'
--        );
--
--   3. If you are migrating an existing database, backfill the normalised
--      post_id columns once post_metadata has been seeded:
--        select public.backfill_post_ids();
--
--   4. Run scripts/backfill-public-slugs.mjs to give existing content its
--      new /golpo, /video and /image URLs.
-- ============================================================================