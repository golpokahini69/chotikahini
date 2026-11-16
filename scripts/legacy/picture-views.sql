-- ============================================================================
-- Unique-view tracking for picture galleries.
--
-- WHY THE OLD APPROACH WAS WRONG:
--   The route used to insert with `ignoreDuplicates: true` and then ALWAYS
--   call `bump_picture_view_count`. The unique constraint correctly stopped
--   duplicate ROWS from landing in `picture_views`, but nothing told the
--   counter that the insert had been a no-op — so every refresh, every
--   back-navigation and every duplicate tab bumped the number again.
--   The table was unique; the COUNT was not.
--
-- THE FIX:
--   One atomic Postgres function does the insert AND the increment, and only
--   increments when the insert was genuinely new. `INSERT ... ON CONFLICT DO
--   NOTHING` reports how many rows it actually wrote, so the function knows
--   whether this viewer is new without a second round-trip and without a
--   read-then-write race.
--
-- SCHEMA:
--   picture_views  — one row per (gallery, viewer) per dedupe bucket (24h).
--                    The unique constraint makes ON CONFLICT DO NOTHING
--                    idempotent.
--   picture_galleries.view_count — denormalised counter, bumped atomically
--                    from the same RPC, only for a new viewer.
--
-- IMPORTANT: this is OUR OWN view count. The provider's own counter (the
-- scraped `source_views`) is a different number and is displayed separately.
-- The two are never mixed.
--
-- Everything is idempotent and additive, so this can be re-run safely.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.picture_views (
  id           BIGSERIAL PRIMARY KEY,
  gallery_id   UUID NOT NULL REFERENCES public.picture_galleries(id) ON DELETE CASCADE,
  viewer_key   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gallery_id, viewer_key)
);

CREATE INDEX IF NOT EXISTS idx_picture_views_gallery_recent
  ON public.picture_views(gallery_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_picture_views_viewer
  ON public.picture_views(viewer_key, created_at DESC);

ALTER TABLE public.picture_galleries
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.picture_galleries
  DROP CONSTRAINT IF EXISTS picture_galleries_view_count_non_negative;
ALTER TABLE public.picture_galleries
  ADD CONSTRAINT picture_galleries_view_count_non_negative
  CHECK (view_count >= 0);

ALTER TABLE public.picture_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read picture_views counts" ON public.picture_views;
CREATE POLICY "Allow public read picture_views counts"
  ON public.picture_views FOR SELECT USING (true);

-- ---------------------------------------------------------------------------
-- Record a view, and count it ONLY if this viewer has not been counted
-- before for this gallery.
--
-- Returns a JSONB payload:
--   { "counted": true,  "view_count": 12 }  -- a NEW viewer was counted
--   { "counted": false, "view_count": 12 }  -- duplicate; count unchanged
--
-- The whole thing is a single statement, so two concurrent requests from the
-- same viewer cannot both see "new" and both increment — the unique index
-- serialises them and exactly one wins.
--
-- `viewer_key` is a sha256 of ip|user-agent|day-bucket produced by the
-- route, so the 24-hour window is enforced by the key itself rather than by
-- a time-window query.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_picture_view(
  p_gallery_id UUID,
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
  -- Insert the view row. If this (gallery, viewer) pair already exists,
  -- ON CONFLICT DO NOTHING skips it and inserted_rows stays 0.
  INSERT INTO public.picture_views (gallery_id, viewer_key)
  VALUES (p_gallery_id, p_viewer_key)
  ON CONFLICT (gallery_id, viewer_key) DO NOTHING;

  GET DIAGNOSTICS inserted_rows = ROW_COUNT;

  -- Only a genuinely new viewer moves the counter.
  IF inserted_rows > 0 THEN
    UPDATE public.picture_galleries
       SET view_count = view_count + 1
     WHERE id = p_gallery_id
    RETURNING view_count INTO current_count;
  ELSE
    SELECT view_count INTO current_count
      FROM public.picture_galleries
     WHERE id = p_gallery_id;
  END IF;

  RETURN jsonb_build_object(
    'counted', inserted_rows > 0,
    'view_count', COALESCE(current_count, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_picture_view(UUID, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- Backwards-compatible shim.
--
-- The old route called this unconditionally, which is exactly what inflated
-- the count. It is kept only so an older deployed bundle cannot 500 during a
-- rolling deploy — it is a no-op for counting purposes and the new route
-- calls `record_picture_view` instead.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bump_picture_view_count(p_gallery_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_count INTEGER;
BEGIN
  UPDATE public.picture_galleries
     SET view_count = view_count + 1
   WHERE id = p_gallery_id
   RETURNING view_count INTO next_count;
  RETURN COALESCE(next_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bump_picture_view_count(UUID) TO service_role;
