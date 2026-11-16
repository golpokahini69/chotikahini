import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { commentId, postSlug } = await req.json();
    if (!commentId) {
      return NextResponse.json({ error: "commentId required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Comments share the one `reports` table with stories now
    // (target_type = 'comment'). `comment_reports` was a second, nearly
    // identical table for the same fact.
    const { error } = await supabase
      .from("reports")
      .upsert(
        {
          target_type: "comment",
          target_id: String(commentId),
          post_slug: postSlug || null,
          reporter_id: session.id,
          status: "pending",
        },
        { onConflict: "reporter_id,target_type,target_id" }
      );

    // Ignore duplicate report (23505) — idempotent
    if (error && error.code !== "23505") {
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Report error:", error);
    return NextResponse.json({ error: "রিপোর্ট করতে সমস্যা হয়েছে" }, { status: 500 });
  }
}
