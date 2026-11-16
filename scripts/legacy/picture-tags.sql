-- ============================================================================
-- Picture gallery tag & category filtering — run once in the Supabase SQL
-- Editor, AFTER scripts/picture-gallery.sql (which creates the
-- `public.lower_array` helper and the GIN indexes these queries rely on).
--
-- Tag links must be CASE-INSENSITIVE. The tags are scraped from the
-- provider, so the same word arrives as "Blonde", "blonde" or "BLONDE",
-- and a case-sensitive `tags @> ARRAY['Blonde']` would only ever find
-- some of the galleries carrying it.
--
-- PostgREST cannot express the lower-cased containment check directly, so
-- the queries live in RPC functions. The GIN indexes in
-- scripts/picture-gallery.sql make the containment check an index scan
-- rather than a table scan.
-- ============================================================================

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

-- ---------------------------------------------------------------------------
-- The same, but also counting the total so the caller can paginate.
-- ---------------------------------------------------------------------------
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
-- Galleries carrying a CATEGORY, newest first.
--
-- Categories are filtered exactly like tags — the same case-insensitive
-- containment check, against the `categories` column.
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

-- ---------------------------------------------------------------------------
-- The same, but also counting the total so the caller can paginate.
-- ---------------------------------------------------------------------------
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
-- have to pull every gallery row to count tags.
--
-- Tags are grouped by their LOWERCASED form, because the same word can
-- arrive from different providers with different capitalisation
-- ("Blonde" and "blonde"). Grouping on the raw text would show the same
-- tag twice in the filter bar, each with a partial count. The first
-- spelling encountered is kept for display.
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
--
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
