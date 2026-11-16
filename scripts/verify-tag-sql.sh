#!/bin/bash
# Runs the picture-gallery + picture-tags SQL against a LOCAL Postgres so
# the syntax is verified before it is pasted into the Supabase SQL Editor.
#
# The scripts are rewritten to use the `pic_test` schema (the real ones
# use `public`), and the navigation UPDATE is skipped because it targets
# `site_settings`, which only exists in the real database.
set -u

CONN="postgresql://postgres:postgres@localhost:5432/postgres"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== preparing test schema ==="
psql "$CONN" -q -v ON_ERROR_STOP=1 <<'SQL'
drop schema if exists pic_test cascade;
create schema pic_test;
SQL

echo "=== rewriting scripts for the test schema ==="
sed 's/public\./pic_test./g; s/set search_path = public/set search_path = pic_test/' \
  "$DIR/picture-gallery.sql" > /tmp/pic-gallery-test.sql
sed 's/public\./pic_test./g; s/set search_path = public/set search_path = pic_test/' \
  "$DIR/picture-tags.sql" > /tmp/pic-tags-test.sql

# Drop the navigation UPDATE — site_settings does not exist here.
python3 - <<'PY'
import re
p = "/tmp/pic-gallery-test.sql"
s = open(p).read()
s = re.sub(r"update pic_test\.site_settings.*?;\s*\Z", "", s, flags=re.S)
open(p, "w").write(s)
PY

echo "=== picture-gallery.sql ==="
psql "$CONN" -q -v ON_ERROR_STOP=1 -f /tmp/pic-gallery-test.sql 2>&1 | grep -v "^$" | tail -10
echo "  exit: ${PIPESTATUS[0]}"

echo "=== picture-tags.sql ==="
psql "$CONN" -q -v ON_ERROR_STOP=1 -f /tmp/pic-tags-test.sql 2>&1 | grep -v "^$" | tail -10
echo "  exit: ${PIPESTATUS[0]}"

echo "=== behaviour test ==="
psql "$CONN" -q -v ON_ERROR_STOP=1 <<'SQL'
set search_path = pic_test;

insert into pic_test.picture_galleries
  (title, source_url, cover_url, tags, categories, status, created_by, published_at)
values
  ('A', 'https://x/a', 'https://x/1.jpg', array['Blonde','MILF'], array['Beautiful'], 'published', 't', now()),
  ('B', 'https://x/b', 'https://x/2.jpg', array['blonde','Nude'],  array['Babe'],    'published', 't', now()),
  ('C', 'https://x/c', 'https://x/3.jpg', array['Solo'],           array['Solo'],    'published', 't', now()),
  ('D', 'https://x/d', 'https://x/4.jpg', array['Draft tag'],      array['Solo'],    'draft',     't', null);

\echo '--- by tag "Blonde" (expect A and B — case-insensitive, draft excluded)'
select title from pic_test.list_pictures_by_tag('Blonde');

\echo '--- count by tag "BLONDE" (expect 2)'
select pic_test.count_pictures_by_tag('BLONDE') as total;

\echo '--- by category "solo" (expect C and A? no — only published rows with that category)'
select title from pic_test.list_pictures_by_category('solo');

\echo '--- all tags with counts'
select * from pic_test.list_picture_tags();

\echo '--- all categories with counts'
select * from pic_test.list_picture_categories();

\echo '--- index usage for the tag filter'
explain (analyze) select * from pic_test.picture_galleries
 where pic_test.lower_array(tags) @> array[lower('Blonde')];
SQL

echo "  exit: $?"
