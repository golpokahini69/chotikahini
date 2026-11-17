import { NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { CACHE_TAGS, invalidateTags } from "@/lib/cache";

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { postSlug } = await req.json();
    if (!postSlug) {
      return NextResponse.json({ error: "postSlug is required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Saved posts are a jsonb array on the user row (`users.saved_posts`).
    // There used to be a separate `bookmarks` table holding the same list,
    // while the UI and the session already read `users.saved_posts` — so a
    // save could succeed in one place and appear unsaved in the other.
    const { data: row, error: readError } = await supabase
      .from("users")
      .select("saved_posts")
      .eq("id", session.id)
      .maybeSingle();
    if (readError) throw readError;

    const current: string[] = Array.isArray(row?.saved_posts) ? row!.saved_posts : [];
    const saved = !current.includes(postSlug);
    const savedPosts = saved
      ? [...current, postSlug]
      : current.filter((slug) => slug !== postSlug);

    const { error: updateError } = await supabase
      .from("users")
      .update({ saved_posts: savedPosts, updated_at: new Date().toISOString() })
      .eq("id", session.id);
    if (updateError) throw updateError;

    // The session-hydrate cache must see the new saved list on the very next
    // request — otherwise the save state reads as stale for up to 60 s.
    invalidateTags(CACHE_TAGS.users);

    await setSession({ ...session, savedPosts });

    return NextResponse.json({ success: true, saved, savedPosts });
  } catch (error: any) {
    console.error("Save post error:", error);
    return NextResponse.json({ error: "Failed to save post" }, { status: 500 });
  }
}
