import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Homepage view totals — REAL counters only, never estimated.
 *
 * Three sources, one number each, all aggregated server-side:
 *   • stories   → sum of `post_views.view_count`   (one row per story)
 *   • videos    → sum of `video_posts.view_count`  (one row per video)
 *   • pictures  → sum of `picture_galleries.view_count` (one row per gallery)
 *
 * PostgREST has no SUM, so the column is read and added here — but this
 * runs on the SERVER inside a cached ISR render: the rows never reach the
 * browser and only four integers do. Adding a database function for this
 * would be a schema change (needs approval); this achieves the same result
 * without touching the database.
 *
 * ── Why some values are `null` ──────────────────────────────────────────
 * `null` means "we could not read this source" — the UI renders `—` for it
 * and, critically, `site` becomes `null` too whenever ANY part is unknown.
 * A partial sum displayed as "site total" would be a fabricated number, and
 * the requirement here is explicitly: no dummy views.
 */
export interface ViewTotals {
  /** Total story views, or null when unreadable. */
  stories: number | null;
  /** Total video views, or null when unreadable. */
  videos: number | null;
  /** Total picture views, or null when unreadable. */
  pictures: number | null;
  /**
   * All three added together. Deliberately null unless every component is
   * known — a "total" that silently omits a section is a wrong number.
   */
  site: number | null;
}

/** Sum one aggregate column; null on any error (never a guessed 0). */
async function sumColumn(table: string, column: string): Promise<number | null> {
  try {
    const supabase = getSupabaseAdmin();
    // The table/column come in as parameters, so Supabase cannot infer a
    // row type — the response is still `{ [column]: number }[]`, cast
    // through `unknown` to say so explicitly.
    const { data, error } = await supabase.from(table).select(column);
    if (error || !Array.isArray(data)) return null;
    let total = 0;
    for (const row of data as unknown as Record<string, unknown>[]) {
      total += Number(row[column]) || 0;
    }
    return total;
  } catch {
    return null;
  }
}

/**
 * Single-flight, NO persistent cache.
 *
 * Why no `cachedRead`/`unstable_cache` here: the Data Cache stores the value
 * across serverless instances and survives deploys for its whole revalidate
 * window, which is exactly how "local shows one number, production shows
 * another" happens — local computed fresh from the DB, production replayed
 * a value cached hours earlier (or from the previous deployment).
 *
 * These totals are three tiny column-only reads on aggregate counters, so
 * paying for them per admin request is cheap and keeps the number TRUE.
 * The only optimisation kept is request-level de-duplication: concurrent
 * callers inside one render share a single in-flight promise.
 */
let inflight: Promise<ViewTotals> | null = null;

async function computeTotals(): Promise<ViewTotals> {
  const [stories, videos, pictures] = await Promise.all([
    sumColumn("post_views", "view_count"),
    sumColumn("video_posts", "view_count"),
    sumColumn("picture_galleries", "view_count"),
  ]);

  const complete = stories !== null && videos !== null && pictures !== null;

  return {
    stories,
    videos,
    pictures,
    // Site total only when all three parts are known — no partial sums
    // presented as a whole.
    site: complete ? (stories as number) + (videos as number) + (pictures as number) : null,
  };
}

/** Real totals for stories, videos and pictures, plus their site-wide sum. */
export async function getViewTotals(): Promise<ViewTotals> {
  if (inflight) return inflight;
  const promise = computeTotals().finally(() => {
    if (inflight === promise) inflight = null;
  });
  inflight = promise;
  return promise;
}
