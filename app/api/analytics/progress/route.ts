import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Records reading progress (scroll % completion) for a logged-in user.
// Always succeeds — analytics must never break the reading experience.
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ ok: true });

    const { postSlug, percent } = await req.json();
    if (!postSlug || typeof percent !== "number") {
      return NextResponse.json({ ok: true });
    }

    const clamped = Math.max(0, Math.min(100, Math.round(percent)));

    const supabase = getSupabaseAdmin();
    // `reading_history` holds the progress now (it used to be a separate
    // `story_progress` table with the same (post_slug, user_id) key).
    await supabase.from("reading_history").upsert(
      {
        post_slug: String(postSlug).slice(0, 300),
        user_id: session.id,
        percent: clamped,
        last_read_at: new Date().toISOString(),
      },
      { onConflict: "post_slug,user_id" }
    );

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
