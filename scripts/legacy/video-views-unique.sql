-- ============================================================================
-- Unique-view tracking for videos.
--
-- WHY THE OLD APPROACH IS WRONG:
--   The in-memory Map keyed by IP/UA was wiped on every serverless cold
--   start, and the read-then-write increment raced with concurrent viewers.
--   We need persistent, unique-per-day recording plus an atomic increment so
--   the count is honest under load.
--
-- SCHEMA:
--   video_views  — one row per (video, viewer) per dedupe bucket (24h). The
--                  unique constraint makes ON CONFLICT DO NOTHING idempotent.
--   video_posts.view_count — denormalised counter, bumped atomically from an
--                  RPC whenever a new row lands in video_views.
--
-- Everything is idempotent and additive, so this can be re-run safely.
--
-- IMPORTANT: video_posts.id is UUID (see scripts/video-library.sql), so the
-- video_id column in video_views must be UUID too. The first run of an
-- earlier draft used TEXT and the FK was rejected.
--
-- That rejected run may still have left a half-created table behind, so we
-- drop it first — there is no production data in it yet.
-- ============================================================================

DROP TABLE IF EXISTS public.video_views CASCADE;

CREATE TABLE IF NOT EXISTS public.video_views (
  id           BIGSERIAL PRIMARY KEY,
  video_id     UUID NOT NULL REFERENCES public.video_posts(id) ON DELETE CASCADE,
  viewer_key   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (video_id, viewer_key)
);

CREATE INDEX IF NOT EXISTS idx_video_views_video_recent
  ON public.video_views(video_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_video_views_viewer
  ON public.video_views(viewer_key, created_at DESC);

ALTER TABLE public.video_posts
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.video_posts
  DROP CONSTRAINT IF EXISTS video_posts_view_count_non_negative;
ALTER TABLE public.video_posts
  ADD CONSTRAINT video_posts_view_count_non_negative
  CHECK (view_count >= 0);

ALTER TABLE public.video_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read video_views counts" ON public.video_views;
CREATE POLICY "Allow public read video_views counts"
  ON public.video_views FOR SELECT USING (true);
-- ---------------------------------------------------------------------------
-- Record a view, and count it ONLY if this viewer has not been counted
-- before for this video.
--
-- Returns a JSONB payload:
--   { "counted": true,  "view_count": 12 }  -- a NEW viewer was counted
--   { "counted": false, "view_count": 12 }  -- duplicate; count unchanged
--
-- The whole thing is a single statement, so two concurrent requests from the
-- same viewer cannot both see "new" and both increment -- the unique index
-- serialises them and exactly one wins.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_video_view(
  p_video_id UUID,
  p_viewer_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_rows INTEGER;
  current_count INTEGER;
BEGIN
  -- Insert the view row. If this (video, viewer) pair already exists,
  -- ON CONFLICT DO NOTHING skips it and inserted_rows stays 0.
  INSERT INTO public.video_views (video_id, viewer_key)
  VALUES (p_video_id, p_viewer_key)
  ON CONFLICT (video_id, viewer_key) DO NOTHING;

  GET DIAGNOSTICS inserted_rows = ROW_COUNT;

  -- Only a genuinely new viewer moves the counter.
  IF inserted_rows > 0 THEN
    UPDATE public.video_posts
       SET view_count = view_count + 1
     WHERE id = p_video_id
    RETURNING view_count INTO current_count;
  ELSE
    SELECT view_count INTO current_count
      FROM public.video_posts
     WHERE id = p_video_id;
  END IF;

  RETURN jsonb_build_object(
    'counted', inserted_rows > 0,
    'view_count', COALESCE(current_count, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_video_view(UUID, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- Backwards-compatible shim.
--
-- The old route called this unconditionally, which is exactly what inflated
-- the count. It is kept only so an older deployed bundle cannot 500 during a
-- rolling deploy -- it is a no-op for counting purposes and the new route
-- calls `record_video_view` instead.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bump_video_view_count(p_video_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_count INTEGER;
BEGIN
  UPDATE public.video_posts
     SET view_count = view_count + 1
   WHERE id = p_video_id
   RETURNING view_count INTO next_count;
  RETURN COALESCE(next_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bump_video_view_count(UUID) TO service_role;
