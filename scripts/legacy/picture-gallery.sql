-- ============================================================================
-- Picture gallery section — run once in the Supabase SQL Editor.
--
-- Mirrors `scripts/video-library.sql`: image files are NEVER uploaded or
-- stored. Only the provider's CDN URLs and the gallery metadata live here,
-- and the browser streams each image straight from the provider's CDN.
--
-- `images` is a JSONB array of:
--   { "url": "<full-size https url>", "thumb": "<https thumbnail url>",
--     "width": 1067, "height": 1600 }
-- Kept on the row rather than in a child table because the images are
-- read-only, always read as one ordered set, and their position/geometry
-- has to stay together.
-- ============================================================================

create table if not exists public.picture_galleries (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 500),
  source_url text not null check (source_url like 'https://%'),
  cover_url text not null check (cover_url like 'https://%'),
  images jsonb not null default '[]'::jsonb
    check (jsonb_typeof(images) = 'array'),
  image_count integer not null default 0 check (image_count >= 0),
  model_name text check (model_name is null or char_length(model_name) <= 120),
  channel_name text check (channel_name is null or char_length(channel_name) <= 120),
  categories text[] default '{}',
  tags text[] default '{}',
  source_views integer check (source_views is null or source_views >= 0),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'deleted')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  -- Future publish time. See scripts/media-schedule.sql.
  scheduled_at timestamptz
);

-- Publication feed index — same partial-index shape as video_posts.
create index if not exists picture_galleries_publication_idx
  on public.picture_galleries (published_at desc)
  where status = 'published';

-- Scheduled-publish lookup (cron sweep + admin "শিডিউলড" filter).
create index if not exists picture_galleries_scheduled_idx
  on public.picture_galleries (scheduled_at)
  where scheduled_at is not null;

-- ---------------------------------------------------------------------------
-- Lower-casing a whole array.
--
-- Tags are scraped from the provider, so the same word arrives with
-- different capitalisation ("Blonde", "blonde", "BLONDE"). A plain
-- `tags @> ARRAY['Blonde']` is case-SENSITIVE, which would make a tag
-- link find only some of the galleries carrying it.
--
-- Postgres has no `lower(text[])` — `lower()` only takes a single `text`.
-- This helper lower-cases each element and reassembles the array:
--
--   public.lower_array(tags) @> ARRAY[lower('Blonde')]
--
-- It is marked IMMUTABLE so it can be used in an index expression.
-- (A plain subquery cannot: "subqueries are not allowed in index
-- expressions".)
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

-- The filter index. GIN gives the index an array-containment operator
-- (`@>`) for free, and the expression index stores the lower-cased form
-- so the comparison never has to touch the raw rows.
--
-- The expression MUST match the one used by the RPCs in
-- scripts/picture-tags.sql exactly, or the index will not be used.
create index if not exists picture_galleries_tags_lower_idx
  on public.picture_galleries using gin (public.lower_array(tags));

-- Same index for categories, which are filtered the same way.
create index if not exists picture_galleries_categories_lower_idx
  on public.picture_galleries using gin (public.lower_array(categories));

alter table public.picture_galleries enable row level security;

-- ---------------------------------------------------------------------------
-- Navigation entry.
--
-- The site's nav is DB-backed (`site_settings` key `navigation`) and the DB
-- row wins over `DEFAULT_NAVIGATION` in lib/site-defaults.ts, so adding the
-- entry to the defaults alone would NOT show it in production. This appends
-- the "ছবি" link if it isn't already there.
--
-- Idempotent: re-running never duplicates the entry.
-- ---------------------------------------------------------------------------
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
