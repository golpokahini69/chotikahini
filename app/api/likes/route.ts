import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { notifyUser } from "@/lib/notify";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug");
    if (!slug) {
      return NextResponse.json({ error: "Slug required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const session = await getSession();

    // The only consumer (LikePostButton) renders a COUNT and whether this
    // viewer already liked the story. It used to receive every liker's
    // user_id as well — a payload that grows with popularity and leaks a
    // list of member IDs to every anonymous visitor. Counting in Postgres
    // (`head: true`) moves no rows over the wire at all; the viewer's own
    // row is the single lookup needed for the "did I like it" state.
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

    // `liked` is viewer-specific, so this response is never shared publicly.
    return NextResponse.json(
      { count: count || 0, liked },
      { headers: { "Cache-Control": "private, no-store" } },
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
