import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { notifyUser } from "@/lib/notify";

/**
 * GET /api/likes?slug=<story>        → count only, publicly edge-cacheable
 * GET /api/likes?slug=<story>&me=1    → count + THIS viewer's state, never cached
 *
 * The count is identical for every visitor of a story; `liked` is not. When
 * both lived in one response the whole response had to be `private, no-store`
 * — so every story view invoked a serverless function and one PostgREST query
 * just to re-deliver a number that does not change.
 *
 * Splitting on `&me=1` keeps the two apart by URL: a request WITHOUT the flag
 * never reads a session, so no per-user data can possibly reach the shared
 * cache; a request WITH it is marked `private, no-store` and is never shared.
 * The client (LikePostButton) picks which URL to use based on whether it knows
 * you are logged in, so it still makes exactly ONE request either way.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug");
    if (!slug) {
      return NextResponse.json({ error: "Slug required" }, { status: 400 });
    }

    // Only a `me=1` request is allowed to learn who is asking. The plain
    // request must not even open the session — that is what makes it safe
    // to serve the same bytes to everyone for a minute.
    const wantsState = url.searchParams.get("me") === "1";
    const session = wantsState ? await getSession() : null;

    const supabase = getSupabaseAdmin();

    // The consumer (LikePostButton) renders a COUNT and whether this viewer
    // already liked the story. It used to receive every liker's user_id — a
    // payload that grows with popularity and leaks a list of member IDs to
    // anonymous visitors. Counting in Postgres (`head: true`) moves no rows
    // over the wire at all.
    const { count } = await supabase
      .from("post_likes")
      .select("id", { count: "exact", head: true })
      .eq("post_slug", slug);

    let liked = false;
    if (session) {
      const { data: mine } = await supabase
        .from("post_likes")
        .select("id")
        .eq("post_slug", slug)
        .eq("user_id", session.id)
        .maybeSingle();
      liked = !!mine;
    }

    const viewerSpecific = wantsState || session !== null;

    return NextResponse.json(
      { count: count || 0, liked },
      {
        headers: viewerSpecific
          ? // Per-viewer answer: must never be shared.
            { "Cache-Control": "private, no-store" }
          : {
              // Identical for every anonymous reader of this story: safe to
              // serve from the Vercel edge for a minute, which removes one
              // function invocation and one PostgREST call per story view.
              "Cache-Control":
                "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
              "CDN-Cache-Control":
                "public, s-maxage=60, stale-while-revalidate=300",
            },
      },
    );
  } catch (error) {
    console.error("Failed to fetch likes", error);
    return NextResponse.json({ count: 0, liked: false });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug, action } = await req.json();
    if (!slug || !["like", "unlike"].includes(action)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Resolve post_id for FK normalization
    const { data: postMeta } = await supabase
      .from("post_metadata")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (action === "like") {
      const { error: insertError } = await supabase
        .from("post_likes")
        .upsert(
          {
            post_slug: slug,
            post_id: postMeta?.id || null,
            user_id: session.id
            // No username/name duplication — use users FK
          },
          { onConflict: 'post_slug,user_id' }
        );
      if (insertError) throw insertError;

      // Notify the post author
      if (postMeta?.id) {
        const { data: pm } = await supabase
          .from("post_metadata")
          .select("author_id")
          .eq("id", postMeta.id)
          .maybeSingle();
        if (pm?.author_id && pm.author_id !== session.id) {
          // Routed through notifyUser so the `id` PK is always set and the
          // resolved Supabase error is inspected. The previous fire-and-forget
          // `.then()` never awaited, so a failed insert was silently lost.
          await notifyUser(
            pm.author_id,
            {
              type: "like",
              actorId: session.id,
              actorName: session.name || session.username,
              postSlug: slug,
              postId: postMeta.id,
            },
            supabase
          );
        }
      }
    } else if (action === "unlike") {
      const { error: deleteError } = await supabase
        .from("post_likes")
        .delete()
        .match({ post_slug: slug, user_id: session.id });
      if (deleteError) throw deleteError;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Like action failed", error);
    return NextResponse.json({ error: "Failed to process like action" }, { status: 500 });
  }
}
