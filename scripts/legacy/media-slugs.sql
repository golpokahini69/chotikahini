-- ============================================================================
-- Public, type-prefixed slugs for stories, videos and picture galleries.
--
-- Run once in the Supabase SQL Editor.
--
-- Why this exists
-- ---------------
-- Published content used to live at opaque URLs: /17384209312 for a story,
-- /videos/<uuid> and /pictures/<uuid> for media. Those links tell a reader
-- (or an editor pasting one into a story) nothing about what they point at.
--
-- This adds a `public_slug` column to each of the three content tables.
-- The slug is the title in English, in kebab-case:
--
--   dhaka-new-bridge
--   jamal-nur-video
--   kutir-chobi
--
-- and the public URL is then /golpo/<slug>, /video/<slug> and /image/<slug>.
--
-- When two items share a title, the second gets a numeric suffix —
-- dhaka-new-bridge, dhaka-new-bridge-1, dhaka-new-bridge-2.
--
-- Uniqueness is PER CONTENT TYPE. A story, a video and an image may all be
-- "dhaka-new-bridge" at the same time, because they live under different
-- URL prefixes. That is why there is one index per table rather than one
-- shared counter.
--
-- This is a NEW column on purpose. `stories.slug` is NOT reused: it is the
-- upsert conflict key for both `stories` and `post_metadata`, and
-- `post_metadata.slug` is the lookup key for comments, likes, pins,
-- bookmarks and saved posts. Repurposing it would break those joins.
--
-- Existing rows are left empty on purpose: content published before this
-- change keeps its old URL, and that old URL keeps working. Only content
-- published from now on gets a slug.
--
-- Idempotent — safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Columns.
--
-- Nullable: a row only has a slug once it has been published with one.
-- ---------------------------------------------------------------------------

alter table public.stories
  add column if not exists public_slug text;

alter table public.video_posts
  add column if not exists public_slug text;

alter table public.picture_galleries
  add column if not exists public_slug text;

-- ---------------------------------------------------------------------------
-- Unique indexes.
--
-- These are PARTIAL indexes (`where public_slug is not null`) so the
-- thousands of existing rows without a slug neither bloat the index nor
-- collide with each other. A partial unique index still enforces
-- uniqueness among the rows that do have one — which is exactly the set
-- that gets published URLs.
--
-- A unique index (rather than a unique constraint) is also what makes the
-- public lookup an index scan: the page routes resolve a slug with an
-- equality match on this column.
--
-- The uniqueness is scoped to the table, i.e. to the content type, which
-- matches the URL prefixes.
-- ---------------------------------------------------------------------------

create unique index if not exists stories_public_slug_idx
  on public.stories (public_slug)
  where public_slug is not null;

create unique index if not exists video_posts_public_slug_idx
  on public.video_posts (public_slug)
  where public_slug is not null;

create unique index if not exists picture_galleries_public_slug_idx
  on public.picture_galleries (public_slug)
  where public_slug is not null;
