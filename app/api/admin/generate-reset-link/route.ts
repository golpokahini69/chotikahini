import { NextResponse } from "next/server";
import crypto from "crypto";
import { isFullAdmin } from "@/lib/admin-auth";
import { getSiteConfig } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/supabase";
import { notifyAdmins, notifyUser } from "@/lib/notify";
import { NOTIFICATION_TYPES } from "@/lib/notify-types";

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const isAdmin = await isFullAdmin();
    if (!isAdmin) {
      return NextResponse.json({ error: "অননুমোদিত অ্যাক্সেস। অ্যাডমিন পারমিশন প্রয়োজন।" }, { status: 401 });
    }

    const { userId } = await req.json();
    if (!userId) {
      return NextResponse.json({ error: "ইউজার আইডি প্রয়োজন।" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: user, error: fetchErr } = await supabase
      .from("users")
      .select("id, username, email, name")
      .eq("id", userId)
      .single();

    if (fetchErr || !user) {
      return NextResponse.json({ error: "ইউজার পাওয়া যায়নি।" }, { status: 404 });
    }

    // Generate secure single-use token valid for 1 hour
    const resetToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

    // Store token in DB. supabase-js resolves rather than rejects, so the
    // `error` MUST be inspected — otherwise the token is never saved and
    // the admin hands the user a link that can never be used.
    const { error: updateErr } = await supabase
      .from("users")
      .update({
        reset_token: resetToken,
        reset_token_expires: expiresAt,
        updated_at: new Date().toISOString()
      })
      .eq("id", user.id);

    if (updateErr) {
      console.error("Generate reset link: failed to store token:", updateErr.message);
      throw updateErr;
    }

    // Single-use token reset URL (contains NO plain password)
    const origin = req.headers.get("origin") || req.headers.get("host") || getSiteConfig().url.replace(/\/$/, "");
    const cleanOrigin = origin.startsWith("http") ? origin : `https://${origin}`;
    const resetUrl = `${cleanOrigin}/auth/reset-password?token=${resetToken}&user=${encodeURIComponent(user.username)}`;

    const emailSubject = `পাসওয়ার্ড রিসেট করার নিরাপত্তা লিঙ্ক — ${getSiteConfig().title}`;
    const emailBody = `প্রিয় ${user.name || user.username},

আপনার অনুরোধের প্রেক্ষিতে আপনার অ্যাকাউন্টের (@${user.username}) জন্য একটি একক ব্যবহারযোগ্য পাসওয়ার্ড রিসেট লিঙ্ক তৈরি করা হয়েছে।

পাসওয়ার্ড রিসেট লিঙ্ক:
${resetUrl}

নোট: এই লিঙ্কটি ১ ঘণ্টার জন্য বৈধ এবং কেবল একবারই নতুন পাসওয়ার্ড সেট করতে ব্যবহার করা যাবে। লিঙ্কটিতে কোনো পাসওয়ার্ড সংরক্ষিত নেই।

ধন্যবাদ,
${getSiteConfig().title} টিম`;

    // Notify the user in-app that a reset link was created.
    //
    // This MUST go through notifyUser: the previous raw insert omitted the
    // `id` column (the notifications PK is NOT NULL) and never checked the
    // resolved Supabase error, so the insert failed every time and the user
    // never received this notification.
    //
    // The copy deliberately does NOT say "check your email" — no email is
    // sent by this system. The admin shares the link directly.
    await notifyUser(
      user.id,
      {
        type: NOTIFICATION_TYPES.PASSWORD_RESET_LINK_GENERATED,
        actorName: "অ্যাডমিন",
        snippet: `আপনার পাসওয়ার্ড রিসেটের একক ব্যবহারযোগ্য লিঙ্ক তৈরি করা হয়েছে। অ্যাডমিন লিঙ্কটি আপনাকে পাঠাবেন।`,
      },
      supabase
    );

    // Also record it for the admins so the panel shows the link was issued.
    await notifyAdmins(
      {
        type: NOTIFICATION_TYPES.PASSWORD_RESET_LINK_GENERATED,
        actorId: user.id,
        actorName: user.name || user.username,
        snippet: `@${user.username} এর জন্য পাসওয়ার্ড রিসেট লিঙ্ক তৈরি করা হয়েছে। লিঙ্কটি ইউজারের কাছে পাঠাতে হবে।`,
      },
      supabase
    );

    return NextResponse.json({
      success: true,
      message: `ইউজারের জন্য একক ব্যবহারযোগ্য পাসওয়ার্ড রিসেট লিঙ্ক সফলভাবে তৈরি হয়েছে!`,
      data: {
        userId: user.id,
        username: user.username,
        email: user.email,
        resetUrl,
        emailSubject,
        emailBody
      }
    });

  } catch (error: any) {
    console.error("Generate reset link error:", error);
    return NextResponse.json({ error: error.message || "রিসেট লিঙ্ক তৈরি করতে সমস্যা হয়েছে।" }, { status: 500 });
  }
}
