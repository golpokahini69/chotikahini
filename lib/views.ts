// ─────────────────────────────────────────────────────────────
// Post views — single source of truth.
//
// ONE table: `post_views`, keyed by `post_slug`.
//
// It used to be two tables (`post_views` by slug plus `post_view_counts`
// by post_metadata.id) holding the same counter for the same story. Every
// reader had to check both and pick a winner, and the two numbers could
// drift apart. The slug is already unique and `post_id` is still stored on
// the row when known, so this file simply reads the one counter.
// ─────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from "@/lib/supabase";

export interface PostRef {
  id?: string | null;        // post_metadata.id — kept for callers, unused here
  slug: string;
}

interface ViewResult {
  /** View count for the post, or 0 when there is no row yet. */
  views: number;
  /** Which table answered — kept so call sites can log a stale-schema DB. */
  source: "post_views" | "none";
}

/** Fetch the view count for a single post. */
export async function getPostViews(post: PostRef): Promise<ViewResult> {
  const supabase = getSupabaseAdmin();

  const { data } = await supabase
    .from("post_views")
    .select("view_count")
    .eq("post_slug", post.slug)
    .maybeSingle();

  if (data && typeof data.view_count === "number") {
    return { views: Number(data.view_count) || 0, source: "post_views" };
  }

  return { views: 0, source: "none" };
}

/**
 * Bulk fetch view counts for many posts in ONE query and stitch them into
 * a Map keyed by slug. Posts without a counter row map to 0.
 */
export async function getPostViewsBySlug(
  posts: PostRef[],
): Promise<Map<string, ViewResult>> {
  const out = new Map<string, ViewResult>();

  if (posts.length === 0) return out;

  const supabase = getSupabaseAdmin();

  // An `in` query resolves as an index scan, so cost stays flat
  // regardless of how many slugs are requested.
  const { data } = await supabase
    .from("post_views")
    .select("post_slug, view_count")
    .in(
      "post_slug",
      posts.map((p) => p.slug),
    );

  const bySlug = new Map<string, number>();
  for (const row of data || []) {
    bySlug.set(row.post_slug, Number(row.view_count) || 0);
  }

  for (const p of posts) {
    const views = bySlug.get(p.slug);
    out.set(
      p.slug,
      views !== undefined
        ? { views, source: "post_views" }
        : { views: 0, source: "none" },
    );
  }

  return out;
}
