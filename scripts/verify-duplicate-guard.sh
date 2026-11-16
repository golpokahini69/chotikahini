#!/bin/bash
# Verifies the duplicate-gallery guard against a LOCAL Postgres.
#
# Rewrites scripts/picture-gallery.sql + scripts/picture-duplicates.sql to
# use the `pic_test` schema, then asserts that:
#   1. the same gallery pasted in different URL shapes gets ONE key
#   2. a different gallery gets a DIFFERENT key
#   3. the unique index refuses a second copy of the same gallery
#   4. a soft-deleted gallery frees its slot (re-publish is allowed)
#   5. existing duplicates are cleaned up by the migration
set -u

CONN="postgresql://postgres:postgres@localhost:5432/postgres"
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/.."

echo "=== preparing test schema ==="
psql "$CONN" -q -v ON_ERROR_STOP=1 <<'SQL'
drop schema if exists pic_test cascade;
create schema pic_test;
SQL

echo "=== rewriting scripts ==="
sed 's/public\./pic_test./g; s/set search_path = public/set search_path = pic_test/' \
  scripts/picture-gallery.sql > /tmp/dup-gallery.sql
sed 's/public\./pic_test./g; s/set search_path = public/set search_path = pic_test/' \
  scripts/picture-duplicates.sql > /tmp/dup-duplicates.sql

# The navigation UPDATE targets site_settings, which only exists in the real DB.
python3 - <<'PY'
import re
p = "/tmp/dup-gallery.sql"
s = open(p).read()
s = re.sub(r"update pic_test\.site_settings.*?;\s*\Z", "", s, flags=re.S)
open(p, "w").write(s)
PY

echo "=== picture-gallery.sql ==="
psql "$CONN" -q -v ON_ERROR_STOP=1 -f /tmp/dup-gallery.sql > /dev/null 2>&1
echo "  exit: $?"

echo "=== picture-duplicates.sql ==="
psql "$CONN" -q -v ON_ERROR_STOP=1 -f /tmp/dup-duplicates.sql 2>&1 \
  | grep -viE "^$|does not exist, skipping" | tail -5
echo "  exit: ${PIPESTATUS[0]}"

echo ""
echo "=== ASSERTION 1: the same gallery in 5 URL shapes => ONE key ==="
psql "$CONN" -q -v ON_ERROR_STOP=1 <<'SQL'
set search_path = pic_test;
select pic_test.picture_source_key(u) as key,
       count(*) as shapes
  from (values
    ('https://www.pornpics.com/galleries/foo-10648923/'),
    ('https://www.pornpics.com/galleries/foo-10648923'),
    ('https://www.pornpics.com/galleries/foo-10648923/?utm_source=twitter'),
    ('https://WWW.PornPics.com/galleries/foo-10648923/'),
    ('http://www.pornpics.com/galleries/foo-10648923/')
  ) as t(u)
 group by 1;
SQL

echo ""
echo "=== ASSERTION 2: a DIFFERENT gallery => a DIFFERENT key ==="
psql "$CONN" -q -v ON_ERROR_STOP=1 <<'SQL'
set search_path = pic_test;
select pic_test.picture_source_key('https://www.pornpics.com/galleries/bar-999/') as other_key;
SQL

echo ""
echo "=== ASSERTION 3: the unique index REFUSES a second copy ==="
psql "$CONN" -q <<'SQL'
set search_path = pic_test;
insert into pic_test.picture_galleries
  (title, source_url, cover_url, status, created_by, published_at)
values ('Gallery A','https://www.pornpics.com/galleries/foo-10648923/','https://x/1.jpg','published','t',now());
SQL
echo "  first insert exit: $? (expect 0)"

psql "$CONN" -q <<'SQL'
set search_path = pic_test;
insert into pic_test.picture_galleries
  (title, source_url, cover_url, status, created_by, published_at)
values ('Gallery A COPY','https://www.pornpics.com/galleries/foo-10648923?utm_source=x','https://x/2.jpg','published','t',now());
SQL
echo "  duplicate insert exit: $? (expect NON-zero = blocked)"

echo ""
echo "=== ASSERTION 4: a soft-deleted gallery frees its slot ==="
psql "$CONN" -q -v ON_ERROR_STOP=1 <<'SQL'
set search_path = pic_test;
update pic_test.picture_galleries set status='deleted' where title='Gallery A';
insert into pic_test.picture_galleries
  (title, source_url, cover_url, status, created_by, published_at)
values ('Gallery A again','https://www.pornpics.com/galleries/foo-10648923/','https://x/3.jpg','published','t',now());
select count(*) as published_copies from pic_test.picture_galleries
 where status='published' and source_key=pic_test.picture_source_key('https://www.pornpics.com/galleries/foo-10648923/');
SQL
echo "  exit: $? (expect 0)"

echo ""
echo "=== ASSERTION 5: migration cleans up pre-existing duplicates ==="
# Drop the unique index first so the duplicate rows can be seeded — this is
# exactly the state a database that already had duplicates would be in.
psql "$CONN" -q -v ON_ERROR_STOP=1 <<'SQL'
set search_path = pic_test;
drop index if exists pic_test.picture_galleries_source_key_uniq;
SQL
psql "$CONN" -q -v ON_ERROR_STOP=1 <<'SQL'
set search_path = pic_test;
-- Three copies of the same gallery, all published.
update pic_test.picture_galleries set status='published' where title like 'Gallery A%';
insert into pic_test.picture_galleries
  (title, source_url, cover_url, status, created_by, published_at, created_at)
values ('dup1','https://www.pornpics.com/galleries/dup-1/','https://x/4.jpg','published','t',now(),now() - interval '3 days'),
       ('dup2','https://www.pornpics.com/galleries/dup-1','https://x/5.jpg','published','t',now(),now() - interval '2 days'),
       ('dup3','https://www.pornpics.com/galleries/dup-1/?utm=x','https://x/6.jpg','published','t',now(),now() - interval '1 day');
SQL
echo "  seed exit: $? (expect 0)"

echo "  --- re-running the migration to prove it de-dupes ---"
sed 's/public\./pic_test./g; s/set search_path = public/set search_path = pic_test/' \
  scripts/picture-duplicates.sql > /tmp/dup-rerun.sql
psql "$CONN" -q -v ON_ERROR_STOP=1 -f /tmp/dup-rerun.sql > /dev/null 2>&1
echo "  migration exit: $?"

psql "$CONN" -q -v ON_ERROR_STOP=1 <<'SQL'
set search_path = pic_test;
select title, status from pic_test.picture_galleries
 where source_key = pic_test.picture_source_key('https://www.pornpics.com/galleries/dup-1/')
 order by created_at desc;
SQL
echo "  exit: $? (expect exactly 1 published + the rest soft-deleted)"
