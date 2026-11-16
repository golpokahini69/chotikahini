-- ============================================================================
--  NEWAGE — PHASE 7 MIGRATION (STAGE 1): INDEX CONSOLIDATION
-- ============================================================================
--
--  NOT YET APPLIED. Review and approve before running.
--
--  Everything in this file is REVERSIBLE: dropping an index removes no data,
--  so each statement has a matching CREATE in §ROLLBACK.
--
--  Why these are safe to drop — each was verified against the live catalog:
--  every index below is a plain btree on a column prefix that a UNIQUE index
--  on the same table already covers, so any query that could use it uses the
--  unique index instead. Dropping them removes write amplification (each
--  INSERT/UPDATE maintained both) and nothing else.
--
--  There are ZERO triggers and ZERO views in this database, so no trigger or
--  view depends on them.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- §1  REDUNDANT — fully covered by a UNIQUE index on the same leading column
-- ---------------------------------------------------------------------------
--
--  post_likes(post_slug)            ⊂ post_likes_post_slug_user_id_key (post_slug, user_id)
--  post_reactions(post_slug)        ⊂ post_reactions_post_slug_user_id_reaction_type_key
--  post_metadata(mdx_uid)           ⊂ post_metadata_mdx_uid_key (UNIQUE mdx_uid)
--  stories(slug)                    ⊂ stories_slug_key (UNIQUE slug)
--  stories(uid)                     ⊂ stories_uid_key (UNIQUE uid)
--  comment_reactions(comment_id)    ⊂ comment_reactions_comment_id_user_id_emoji_key
--  story_coauthors(story_uid)       ⊂ story_coauthors_story_uid_user_id_key
--  user_follows(user_id)            ⊂ user_follows_user_id_author_id_key
-- ---------------------------------------------------------------------------

drop index if exists public.idx_likes_post_slug;
drop index if exists public.idx_reactions_post_slug;
drop index if exists public.idx_pm_uid;
drop index if exists public.idx_stories_slug;
drop index if exists public.idx_stories_uid;
drop index if exists public.idx_comment_reactions_comment;
drop index if exists public.idx_story_coauthors_story;
drop index if exists public.idx_follows_user;


-- ---------------------------------------------------------------------------
-- §2  UNUSED — the column is never used as a predicate or sort key
-- ---------------------------------------------------------------------------
--
--  idx_comments_pinned indexes `is_pinned`, but the only queries that touch
--  that column SELECT it or UPDATE it by primary key. Nothing filters or
--  sorts on `is_pinned`, so the index is maintained on every comment
--  insert for no read benefit. Pinning sorts in application code.
-- ---------------------------------------------------------------------------

drop index if exists public.idx_comments_pinned;


-- ---------------------------------------------------------------------------
-- §3  MISSING INDEXES on real query paths
-- ---------------------------------------------------------------------------
--
--  Two foreign keys are read on hot paths and had no index, so Postgres had
--  to scan the child table to find a parent's rows.
--
--  chat_messages(user_id)      — moderation and per-user message lookups.
--  post_metadata(story_id)     — joining a story to its metadata row.
-- ---------------------------------------------------------------------------

create index if not exists idx_chat_messages_user
  on public.chat_messages(user_id);

create index if not exists idx_post_metadata_story
  on public.post_metadata(story_id)
  where story_id is not null;


-- ---------------------------------------------------------------------------
-- §ROLLBACK — recreate exactly what §1/§2 dropped.
-- ---------------------------------------------------------------------------

-- create index if not exists idx_likes_post_slug            on public.post_likes(post_slug);
-- create index if not exists idx_reactions_post_slug        on public.post_reactions(post_slug);
-- create index if not exists idx_pm_uid                     on public.post_metadata(mdx_uid);
-- create index if not exists idx_stories_slug               on public.stories(slug);
-- create index if not exists idx_stories_uid                on public.stories(uid);
-- create index if not exists idx_comment_reactions_comment  on public.comment_reactions(comment_id);
-- create index if not exists idx_story_coauthors_story      on public.story_coauthors(story_uid);
-- create index if not exists idx_follows_user               on public.user_follows(user_id);
-- create index if not exists idx_comments_pinned            on public.comments(is_pinned);
-- drop index if exists public.idx_chat_messages_user;
-- drop index if exists public.idx_post_metadata_story;
