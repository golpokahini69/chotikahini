import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { requirePermission } from "@/lib/admin-auth";
import { logAudit } from "@/lib/audit";
import { notifyUser } from "@/lib/notify";
import { NOTIFICATION_TYPES } from "@/lib/notify-types";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { authorized } = await requirePermission("authors.manage");
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const { data: applications, error } = await supabase
      .from("author_applications")
      .select(`
        id, username, real_name, sample_link, message, status, created_at, reviewed_at,
        users:user_id ( id, name, email, profile_pic )
      `)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ applications: applications || [] });
  } catch (e) {
    return NextResponse.json({ applications: [] });
  }
}

export async function POST(req: Request) {
  try {
    const { authorized } = await requirePermission("authors.manage");
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = await getSession();
    const { action, appId } = await req.json();
    if (!action || !appId) {
      return NextResponse.json({ error: "Missing action or appId" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Fetch the application
    const { data: app, error: fetchErr } = await supabase
      .from("author_applications")
      .select("*")
      .eq("id", appId)
      .single();

    if (fetchErr || !app) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }

    const newStatus = action === "approve" ? "approved" : "rejected";

    // Update application status
    const { error: updateErr } = await supabase
      .from("author_applications")
      .update({
        status: newStatus,
        reviewer_id: session?.id || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", appId);

    if (updateErr) throw updateErr;

    // If approved → upgrade user role + send notification
    if (action === "approve" && app.user_id) {
      const { error: roleUpdateError } = await supabase
        .from("users")
        .update({ role: "author" })
        .eq("id", app.user_id);
      if (roleUpdateError) throw roleUpdateError;

      // Send notification. The previous raw insert used `id: "notif_" +
      // Date.now()` and was swallowed by an empty catch — it failed silently
      // whenever the author id did not resolve, so the applicant never knew
      // their application was approved.
      await notifyUser(
        app.user_id,
        {
          type: NOTIFICATION_TYPES.AUTHOR_APPROVED,
          actorId: session?.id || null,
          actorName: session?.name || session?.username || "অ্যাডমিন",
          snippet: "আপনার লেখক আবেদন অনুমোদিত হয়েছে! এখন আপনি গল্প জমা দিতে পারবেন।",
        },
        supabase
      );
    }

    logAudit(session, { action: "authors.manage", targetType: "author_application", targetId: appId, prevState: { status: app.status }, newState: { status: newStatus } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Admin application action error:", error);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
