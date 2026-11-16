import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSupabaseAdmin } from "@/lib/supabase";
import { notifyAdmins, notifyUser } from "@/lib/notify";
import { NOTIFICATION_TYPES } from "@/lib/notify-types";

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { token, username, newPassword } = await req.json();
    const cleanToken = (token || "").trim();
    const cleanUsername = (username || "").trim().toLowerCase();
    const cleanPassword = (newPassword || "").trim();

    if (!cleanToken || !cleanUsername || !cleanPassword) {
      return NextResponse.json({ error: "টোকেন, ইউজারনেম এবং নতুন পাসওয়ার্ড প্রদান করা আবশ্যক।" }, { status: 400 });
    }

    if (cleanPassword.length < 6) {
      return NextResponse.json({ error: "পাসওয়ার্ড ন্যূনতম ৬ অক্ষরের হতে হবে।" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Verify token and user
    const { data: user, error: fetchErr } = await supabase
      .from("users")
      .select("id, username, name, email, reset_token, reset_token_expires")
      .eq("username", cleanUsername)
      .eq("reset_token", cleanToken)
      .maybeSingle();

    if (fetchErr || !user) {
      return NextResponse.json({ error: "অকার্যকর অথবা মেয়াদোত্তীর্ণ পাসওয়ার্ড রিসেট টোকেন।" }, { status: 400 });
    }

    // Check expiry
    if (user.reset_token_expires && new Date(user.reset_token_expires).getTime() < Date.now()) {
      return NextResponse.json({ error: "পাসওয়ার্ড রিসেট লিঙ্কের মেয়াদ শেষ হয়ে গেছে। নতুন অনুরোধ করুন।" }, { status: 400 });
    }

    // Hash new password and clear single-use token immediately
    const hashedPassword = await bcrypt.hash(cleanPassword, 10);

    // supabase-js resolves rather than rejects, so the `error` MUST be
    // inspected — otherwise a failed write is silently ignored and the
    // user is told their password changed when it did not.
    const { error: updateErr } = await supabase
      .from("users")
      .update({
        password_hash: hashedPassword,
        reset_token: null,
        reset_token_expires: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", user.id);

    if (updateErr) {
      console.error("Reset password: failed to update password:", updateErr.message);
      throw updateErr;
    }

    // Notify BOTH sides that the password was reset: the user (so they
    // know it worked and that any old password is now invalid) and the
    // admins (so the request is closed out in the admin panel).
    const actorName = user.name || user.username;

    await notifyUser(
      user.id,
      {
        type: NOTIFICATION_TYPES.PASSWORD_RESET_COMPLETED,
        actorName: "সিস্টেম",
        snippet: `আপনার পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে। এখন নতুন পাসওয়ার্ড দিয়ে প্রবেশ করুন।`,
      },
      supabase
    );

    await notifyAdmins(
      {
        type: NOTIFICATION_TYPES.PASSWORD_RESET_COMPLETED,
        actorId: user.id,
        actorName,
        snippet: `পাসওয়ার্ড রিসেট সম্পন্ন: @${user.username} তার নতুন পাসওয়ার্ড সেট করেছেন।`,
      },
      supabase
    );

    return NextResponse.json({
      success: true,
      message: "আপনার পাসওয়ার্ড সফলভাবে রিসেট ও হালনাগাদ করা হয়েছে! নতুন পাসওয়ার্ড দিয়ে প্রবেশ করুন।"
    });

  } catch (error: any) {
    console.error("Reset password error:", error);
    return NextResponse.json({ error: "পাসওয়ার্ড পরিবর্তন করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।" }, { status: 500 });
  }
}
