// ─────────────────────────────────────────────────────────────
// lib/trending.ts — the "trending stories" list.
//
// Server-side only (imports the DB client + Next Data Cache).
//
// This used to live inside `/api/trending` and was fetched by a client
// component on every page, which meant:
//   • one HTTP round-trip per page view,
//   • a skeleton → content layout shift in every sidebar,
//   • extra client JS and hydration work.
//
// The sidebar is a Server Component, so the list is now resolved during the
// render (from the shared multi-tier cache) and shipped inside the HTML.
// The API route still exists for any external consumer and reuses this same
// cached function.
// ─────────────────────────────────────────────────────────────

import { getAllPostsAsync } from "@/lib/posts";
import { CACHE_TAGS, cachedRead } from "@/lib/cache";
import { getSupabaseAdmin } from "@/lib/supabase";

export interface TrendingPost {
  slug: string;
  uid: string | null;
  title: string;
  cover: string | null;
  categoryName: string;
  likeCount: number;
  viewCount: number;
}

export const getTrendingPosts = cachedRead(
  "trending",
  async (): Promise<TrendingPost[]> => {
    const posts = await getAllPostsAsync();
    if (!posts.length) return [];

    const supabase = getSupabaseAdmin();
    // These tables grow with every like/view, so each read is bounded to
    // the number of published stories rather than pulling the full table.
    const postLimit = Math.max(posts.length * 5, 2000);
    const [
      { data: likes, error: likesError },
      { data: views, error: viewsError },
    ] = await Promise.all([
      supabase.from("post_likes").select("post_slug").limit(postLimit),
      supabase.from("post_views").select("post_slug, view_count").limit(postLimit),
    ]);
    if (likesError) throw likesError;
    if (viewsError && viewsError.code !== "42P01" && viewsError.code !== "PGRST205") {
      throw viewsError;
    }

    const likeCounts: Record<string, number> = {};
    const viewCounts: Record<string, number> = {};
    for (const like of likes || []) {
      if (like.post_slug) likeCounts[like.post_slug] = (likeCounts[like.post_slug] || 0) + 1;
    }
    for (const view of views || []) {
      if (view.post_slug) viewCounts[view.post_slug] = view.view_count || 0;
    }

    const scoredPosts = posts.map((post) => {
      const likeCount = likeCounts[post.slug] || 0;
      const viewCount = viewCounts[post.slug] ?? 0;
      return {
        slug: post.slug,
        uid: post.uid,
        title: post.title,
        cover: post.cover || null,
        categoryName: post.categoryName || "",
        likeCount,
        viewCount,
      };
    });

    return scoredPosts
      .sort((a, b) => b.viewCount - a.viewCount || b.likeCount - a.likeCount)
      .slice(0, 5);
  },
  {
    revalidate: 3600,
    tags: [CACHE_TAGS.posts],
  },
);
