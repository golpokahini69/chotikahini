-- ============================================================================
-- Duplicate-gallery protection for the picture section.
--
-- WHY:
--   The admin could publish the SAME gallery repeatedly — the same URL,
--   pasted with a trailing slash, with a tracking query string, or with
--   `www.` on or off. Every copy created another card on /pictures showing
--   the same pictures, and every copy counted its own views.
--
-- THE FIX (three layers):
--   1. A generated `source_key` column holding the canonical form of the
--      URL (host without `www.`, no query string, no trailing slash).
--   2. A UNIQUE index on that column — the database itself refuses the
--      second copy, so even two admins publishing at the same instant
--      cannot both win.
--   3. The API route checks first and returns a friendly Bengali message,
--      so the admin sees WHY rather than a raw database error.
--
-- The unique index is PARTIAL: soft-deleted rows (`status = 'deleted'`)
-- are excluded, so a gallery can be deleted and later re-published without
-- fighting the constraint.
--
-- IMPORTANT: run this AFTER scripts/picture-gallery.sql.
-- Everything here is idempotent and safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The canonical key.
--
-- A plain SQL function is used rather than a giant expression because the
-- normalisation has several ordered steps, and a generated column can only
-- call IMMUTABLE functions.
--
-- The steps mirror lib/picture-source-url.ts:
--   • drop the scheme
--   • drop the query string and the fragment
--   • drop a leading "www." from the host
--   • lower-case the host
--   • drop a trailing slash from the path
--   • KEEP the path — two galleries on the same host are different
--     galleries, so the path is part of the identity.
-- ---------------------------------------------------------------------------
create or replace function public.picture_source_key(url text)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  rest    text;
  host    text;
  path    text;
begin
  if url is null then
    return null;
  end if;

  -- 1. Drop the scheme: everything up to and including "://".
  rest := split_part(url, '://', 2);
  if rest = url then
    -- No scheme at all — use the string as-is.
    rest := url;
  end if;

  -- 2. Drop the query string, then the fragment.
  rest := split_part(rest, '?', 1);
  rest := split_part(rest, '#', 1);

  -- 3. Split the host from the path.
  --    The path is everything after the FIRST slash. When there is no
  --    slash at all, the whole string is the host and the path is empty.
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

-- ---------------------------------------------------------------------------
-- 2. The generated column.
--
-- `source_key` is always recomputed by the database from `source_url`, so
-- it can never drift out of sync with the URL it describes.
-- ---------------------------------------------------------------------------
alter table public.picture_galleries
  drop column if exists source_key;

alter table public.picture_galleries
  add column source_key text
    generated always as (public.picture_source_key(source_url)) stored;

-- ---------------------------------------------------------------------------
-- 3. Clean up any duplicates that already slipped in before this migration.
--
-- Older copies of the same gallery are kept only in their most recent,
-- non-deleted form; the rest are soft-deleted so nothing is destroyed and
-- the admin can still recover them.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. The unique index.
--
-- Partial, so a soft-deleted gallery frees its slot and can be re-published.
-- ---------------------------------------------------------------------------
create unique index if not exists picture_galleries_source_key_uniq
  on public.picture_galleries (source_key)
  where status <> 'deleted';

-- ---------------------------------------------------------------------------
-- 5. A helper the API route can call to look a gallery up by its URL
--    without repeating the normalisation expression.
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
