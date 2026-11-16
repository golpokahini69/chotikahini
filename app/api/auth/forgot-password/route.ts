import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { notifyAdmins } from "@/lib/notify";
import { NOTIFICATION_TYPES } from "@/lib/notify-types";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { safeIdentifier } from "@/lib/utils";

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    // Forgot-password is a high-value attack surface: enumeration +
    // email-bombing. Cap tightly: 5 / 10 min per IP.
    const rl = rateLimit(`forgot:${clientIp(req)}`, { windowMs: 10 * 60_000, max: 5 });
    if (!rl.ok) {
      return NextResponse.json(
        { success: true, message: "অনুরোধ গ্রহণ করা হয়েছে।" },
        { status: 200, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }

    const { username, email } = await req.json();
    const cleanUsername = (username || "").trim().toLowerCase();
    const cleanEmail = (email || "").trim().toLowerCase();

    if (!cleanUsername || !cleanEmail) {
      return NextResponse.json({ error: "ইউজারনেম এবং ইমেইল ঠিকানা দুটিই প্রদান করা আবশ্যক।" }, { status: 400 });
    }

    // Reject anything that would break the PostgREST filter or look like
    // a malformed email. Returning a generic 200 keeps the
    // account-enumeration surface flat.
    if (!safeIdentifier(cleanUsername, 80) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return NextResponse.json(
        { success: true, message: "অনুরোধ গ্রহণ করা হয়েছে।" },
        { status: 200 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Find user matching BOTH username and email
    const { data: user, error: fetchErr } = await supabase
      .from("users")
      .select("id, username, email, name, reset_token, reset_token_expires")
      .eq("username", cleanUsername)
      .ilike("email", cleanEmail)
      .maybeSingle();

    if (fetchErr || !user) {
      return NextResponse.json(
        { success: true, message: "যদি এই ইউজারনেম ও ইমেইলের সাথে কোনো অ্যাকাউন্ট থাকে, রিসেট লিংক শীঘ্রই পাঠানো হবে।" },
        { status: 200 }
      );
    }

    // Generate secure single-use token valid for 1 hour
    const resetToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

    // Save token to Supabase users table.
    //
    // CRITICAL: supabase-js RESOLVES on failure instead of rejecting, so the
    // `error` field MUST be inspected. Without this check a missing
    // `reset_token` column (or any other write failure) was silently ignored
    // and every reset ended in "মেয়াদোত্তীর্ণ পাসওয়ার্ড রিসেট টোকেন".
    const { error: tokenError } = await supabase
      .from("users")
      .update({
        reset_token: resetToken,
        reset_token_expires: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (tokenError) {
      console.error("Forgot password: failed to store reset token:", tokenError.message);
      return NextResponse.json(
        { error: "পাসওয়ার্ড রিসেট লিঙ্ক তৈরি করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।" },
        { status: 500 }
      );
    }

    // The reset URL / email template is NOT built here. The admin panel
    // produces it via /api/admin/generate-reset-link, which is the only
    // place the link is generated and shared with the user.

    // Notify admins about the request (No plain password involved).
    //
    // The admin panel turns this notification into an actionable
    // "রিসেট লিঙ্ক তৈরি" button; the admin then shares the link with the
    // user directly.
    const notified = await notifyAdmins(
      {
        type: NOTIFICATION_TYPES.FORGOT_PASSWORD_REQUEST,
        actorId: user.id,
        actorName: user.name || user.username,
        snippet: `পাসওয়ার্ড রিসেট লিংক আবেদন: @${user.username} (${user.email})`,
      },
      supabase
    );

    if (!notified) {
      console.error("Forgot password: failed to notify admins for user", user.id);
    }

    // NOTE: the reset token/URL is deliberately NOT returned to the
    // anonymous caller. Returning it (plus the real username/email) for
    // matching accounts while returning a generic response for
    // non-matching ones is a user-enumeration oracle, and it handed a
    // live reset token to anyone who knew a username+email pair.
    // The admin panel is the only place the link is produced.
    return NextResponse.json({
      success: true,
      message: "পাসওয়ার্ড রিসেটের অনুরোধ গ্রহণ করা হয়েছে। অ্যাডমিন শীঘ্রই আপনার সাথে যোগাযোগ করবেন।",
    });

  } catch (error: any) {
    console.error("Forgot password error:", error);
    return NextResponse.json({ error: "পাসওয়ার্ড রিসেট করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।" }, { status: 500 });
  }
}
