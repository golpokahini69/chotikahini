import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Canonical reaction keys (displayed with modern icons, never emoji).
const VALID_REACTIONS = ["love", "thumbs_up", "laugh", "wow"];

// Legacy emoji values stored before the icon migration — map them to the
// canonical keys so existing reaction counts keep working.
const LEGACY_REACTION_ALIASES: Record<string, string> = {
  "\u2764\uFE0F": "love",
  "\u2764": "love",
  "\uD83D\uDC4D": "thumbs_up",
  "\uD83D\uDE02": "laugh",
  "\uD83D\uDE2E": "wow",
};

function normalizeReaction(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (VALID_REACTIONS.includes(raw)) return raw;
  return LEGACY_REACTION_ALIASES[raw] || "";
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const idsParam = url.searchParams.get("commentIds");
    const singleId = url.searchParams.get("commentId");

    // Batch form: `?commentIds=a,b,c` — every comment on a page is resolved
    // in one request instead of one request per comment. Legacy single form
    // (`?commentId=`) is kept for compatibility.
    const ids = (
      idsParam
        ? idsParam.split(",")
        : singleId
          ? [singleId]
          : []
    )
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 80);

    if (ids.length === 0) return NextResponse.json({ reactions: {} });

    const supabase = getSupabaseAdmin();
    const session = await getSession();

    const { data } = await supabase
      .from("comment_reactions")
      .select("comment_id, emoji, user_id")
      .in("comment_id", ids);

    const emptyGrouped = () => {
      const grouped: Record<string, { count: number; reacted: boolean }> = {};
      for (const key of VALID_REACTIONS) grouped[key] = { count: 0, reacted: false };
      return grouped;
    };

    const groupedById = new Map<string, Record<string, { count: number; reacted: boolean }>>();
    for (const id of ids) groupedById.set(id, emptyGrouped());

    for (const row of data || []) {
      const grouped = groupedById.get(row.comment_id);
      if (!grouped) continue;
      const key = normalizeReaction(row.emoji);
      if (!key || !grouped[key]) continue;
      grouped[key].count++;
      if (session && row.user_id === session.id) grouped[key].reacted = true;
    }

    // Viewer-specific (`reacted`), so only the browser may cache it.
    const headers = { "Cache-Control": "private, max-age=30" };

    if (idsParam) {
      return NextResponse.json(
        { reactionsByComment: Object.fromEntries(groupedById) },
        { headers },
      );
    }

    return NextResponse.json({ reactions: groupedById.get(ids[0]) }, { headers });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { commentId, emoji } = await req.json();
    const canonical = normalizeReaction(emoji);
    if (!commentId || !canonical) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Toggle reaction (matches stored legacy emoji OR canonical key)
    const { data: existing } = await supabase
      .from("comment_reactions")
      .select("id")
      .eq("comment_id", commentId)
      .eq("user_id", session.id)
      .in("emoji", [canonical, ...Object.keys(LEGACY_REACTION_ALIASES).filter(k => LEGACY_REACTION_ALIASES[k] === canonical)])
      .maybeSingle();

    if (existing) {
      await supabase.from("comment_reactions").delete().eq("id", existing.id);
      return NextResponse.json({ reacted: false });
    } else {
      await supabase.from("comment_reactions").insert({
        comment_id: commentId,
        user_id: session.id,
        emoji: canonical,
      });
      return NextResponse.json({ reacted: true });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
