import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Canonical reaction keys (displayed with modern icons, never emoji).
const VALID_REACTIONS = ["love", "thumbs_up", "laugh", "wow"];

function normalizeReaction(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  return VALID_REACTIONS.includes(raw) ? raw : "";
}

/**
 * GET /api/reactions?slug=<story-slug>
 *
 * Returns the reaction counts for a story, plus whether the current viewer
 * has already left each reaction.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug");
    if (!slug) return NextResponse.json({ reactions: {} });

    const supabase = getSupabaseAdmin();
    const session = await getSession();

    const { data } = await supabase
      .from("post_reactions")
      .select("reaction_type, user_id")
      .eq("post_slug", slug);

    const grouped: Record<string, { count: number; reacted: boolean }> = {};
    for (const key of VALID_REACTIONS) {
      grouped[key] = { count: 0, reacted: false };
    }
    for (const row of data || []) {
      const key = normalizeReaction(row.reaction_type);
      if (!key || !grouped[key]) continue;
      grouped[key].count++;
      if (session && row.user_id === session.id) grouped[key].reacted = true;
    }

    return NextResponse.json({ reactions: grouped });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/reactions  { slug, reaction }
 *
 * Toggles one reaction on a story. Sending the same reaction twice removes
 * it — the UI is a toggle, so the client does not have to know the current
 * state to decide what to send.
 */
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { slug, reaction } = await req.json();
    const canonical = normalizeReaction(reaction);
    if (!slug || !canonical) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Resolve post_id for the normalised FK. It is optional — a story that
    // has no post_metadata row still gets a valid reaction via post_slug.
    const { data: postMeta } = await supabase
      .from("post_metadata")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    const { data: existing } = await supabase
      .from("post_reactions")
      .select("id")
      .eq("post_slug", slug)
      .eq("user_id", session.id)
      .eq("reaction_type", canonical)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase.from("post_reactions").delete().eq("id", existing.id);
      if (error) throw error;
      return NextResponse.json({ reacted: false });
    }

    const { error } = await supabase.from("post_reactions").insert({
      post_slug: slug,
      post_id: postMeta?.id || null,
      user_id: session.id,
      reaction_type: canonical,
    });
    if (error) throw error;

    return NextResponse.json({ reacted: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
