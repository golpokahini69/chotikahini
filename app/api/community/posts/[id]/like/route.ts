import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { notifyUser } from "@/lib/notify";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "লগইন করুন" }, { status: 401 });

    const postId = Number(id);
    if (!Number.isInteger(postId) || postId <= 0) {
      return NextResponse.json({ error: "Invalid post id" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: post } = await supabase
      .from("posts")
      .select("id, user_id, likes_count")
      .eq("id", postId)
      .maybeSingle();

    if (!post) return NextResponse.json({ error: "পোস্টটি পাওয়া যায়নি" }, { status: 404 });

    const { data: existing } = await supabase
      .from("posts_likes")
      .select("post_id")
      .eq("post_id", postId)
      .eq("user_id", session.id)
      .maybeSingle();

    if (existing) {
      await supabase.from("posts_likes").delete().eq("post_id", postId).eq("user_id", session.id);
      await supabase.from("posts").update({ likes_count: Math.max(0, (post.likes_count || 0) - 1) }).eq("id", postId);
      return NextResponse.json({ success: true, liked: false, likesCount: Math.max(0, (post.likes_count || 0) - 1) });
    }

    await supabase.from("posts_likes").insert({ post_id: postId, user_id: session.id });
    await supabase.from("posts").update({ likes_count: (post.likes_count || 0) + 1 }).eq("id", postId);

    if (post.user_id && post.user_id !== session.id) {
      await notifyUser(
        post.user_id,
        {
          type: "post_like",
          actorId: session.id,
          actorName: session.name || session.username,
          snippet: "আপনার পোস্টে লাইক পেয়েছেন",
        },
        supabase
      );
    }

    return NextResponse.json({ success: true, liked: true, likesCount: (post.likes_count || 0) + 1 });
  } catch (error: any) {
    console.error("POST /api/community/posts/[id]/like error:", error);
    return NextResponse.json({ error: "অপারেশন ব্যর্থ" }, { status: 500 });
  }
}