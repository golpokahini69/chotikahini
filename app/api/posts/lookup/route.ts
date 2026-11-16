import { NextResponse } from "next/server";
import { normalizeRef } from "@/lib/posts";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { isAtLeast, hasPermission } from "@/lib/permissions";
import { safeIdentifier } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/posts/lookup?ref=<slug | uid | full-url>
 * Returns the metadata (title, tags, category, author, cover, ...) of a
 * single post so editors can auto-import the previous post's details
 * (series linking).
 *
 * The story is fetched DIRECTLY from the stories table (no cached post
 * list), so a just-scheduled / just-published story is always found.
 *
 * Visibility: published posts are public. NOT-yet-published posts
 * (scheduled / pending) are only visible to the post's own author or an
 * admin/moderator — so a scheduled story's data can be imported by its
 * author for a series, but is never leaked to random visitors.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const ref = searchParams.get("ref") || "";
    const q = normalizeRef(ref);
    if (!q) {
      return NextResponse.json({ error: "স্লাগ বা লিংক দিন।" }, { status: 400 });
    }

    // `q` is interpolated straight into a PostgREST `.or()` filter, where
    // commas separate the OR'd conditions and dots introduce nested
    // filters. A crafted `ref` could smuggle an extra filter past the
    // visibility checks below. `safeIdentifier` accepts only the characters
    // that legitimately appear in a slug / uid / public slug and rejects
    // everything else.
    const safeQ = safeIdentifier(q);
    if (!safeQ) {
      return NextResponse.json({ error: "স্লাগ বা লিংক দিন।" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    // `content` is intentionally NOT selected: the response only returns
    // metadata, and pulling the full article body (up to ~65 KB) over the
    // wire only to discard it wasted bandwidth and JSON parsing on every
    // lookup. The visibility rules below are unchanged.
    //
    // `public_slug` is matched too, so an editor can paste the new
    // `/golpo/<public-slug>` URL and have it resolve. The column is
    // optional (scripts/media-slugs.sql) — a missing column makes the
    // whole query fail, so fall back to the two-column filter.
    const buildQuery = (columns: string, filter: string) =>
      supabase
        .from("stories")
        .select(columns)
        .or(filter)
        .maybeSingle();

    const COLUMNS =
      "uid, slug, title, description, category, tags, cover, author_id, previous_post, status, published_at, updated_at";

    let result = await buildQuery(
      `${COLUMNS}, public_slug`,
      `slug.eq.${safeQ},uid.eq.${safeQ},public_slug.eq.${safeQ}`,
    );

    if (result.error) {
      const message = result.error.message ?? "";
      if (
        result.error.code === "42703" ||
        result.error.code === "PGRST204" ||
        /column .* does not exist|could not find the .* in the schema cache/i.test(
          message,
        )
      ) {
        // `public_slug` column missing — run scripts/media-slugs.sql.
        result = await buildQuery(COLUMNS, `slug.eq.${safeQ},uid.eq.${safeQ}`);
      }
    }

    const post = result.data as {
      uid: string;
      slug: string;
      title: string;
      description: string | null;
      category: string | null;
      tags: string[] | null;
      cover: string | null;
      author_id: string | null;
      previous_post: string | null;
      status: string;
      published_at: string | null;
      updated_at: string | null;
    } | null;

    if (!post) {
      return NextResponse.json({ error: "কোনো লেখা পাওয়া যায়নি।" }, { status: 404 });
    }

    // Resolve the author display name from the users table.
    let authorName = post.author_id || "";
    try {
      const { data: au } = await supabase
        .from("users")
        .select("name, username")
        .eq("id", post.author_id || "admin")
        .maybeSingle();
      if (au) authorName = au.name || au.username || post.author_id || "";
    } catch {}

    const isPublished = post.status === "published" && new Date(post.published_at || 0).getTime() <= Date.now();

    if (!isPublished) {
      const session = await getSession();
      const isAuthor = !!session && (session.id === post.author_id || session.username === post.author_id);
      const isAdmin = !!session && (isAtLeast(session.role, "moderator") || hasPermission(session.role, "story.review"));
      if (!isAuthor && !isAdmin) {
        return NextResponse.json({ error: "কোনো লেখা পাওয়া যায়নি।" }, { status: 404 });
      }
    }

    return NextResponse.json({
      uid: post.uid || "",
      slug: post.slug,
      title: post.title || "",
      description: post.description || "",
      tags: Array.isArray(post.tags) ? post.tags : [],
      category: post.category || "golpo",
      categoryName: post.category || "golpo",
      authorId: post.author_id || "admin",
      authorName,
      cover: post.cover || "",
      previousPost: post.previous_post ? post.previous_post.replace(/^\//, "") : null,
    });
  } catch (error: any) {
    console.error("Post lookup error:", error);
    return NextResponse.json({ error: "লেখা খুঁজে পাওয়া যায়নি।" }, { status: 500 });
  }
}
