import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { getMemberSessions } from "@/lib/auth-tracking";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/member-activity
 *
 * "কে কখন লগইন করল, কখন বের হলো, আর কতক্ষণ অ্যাকটিভ ছিল" — fed by the auth
 * events written at login/logout (lib/auth-tracking.ts).
 *
 * Query params:
 *   userId    – filter to one member
 *   days      – look-back window (1–90, default 7)
 *   limit     – max sessions (default 200)
 *
 * Access: users.view (admins/superadmins). Member session history is
 * moderation data, never public.
 */
export async function GET(req: Request) {
  const { authorized } = await requirePermission("users.view");
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");
    const days = Number(searchParams.get("days") || "7");
    const limit = Number(searchParams.get("limit") || "200");

    const { sessions, totalEvents } = await getMemberSessions({
      userId: userId || null,
      sinceDays: Number.isFinite(days) ? days : 7,
      limit: Number.isFinite(limit) ? limit : 200,
    });

    // Aggregate per member for the summary strip at the top of the section.
    const byMember = new Map<string, { username: string; role: string; sessions: number; totalSeconds: number }>();
    for (const session of sessions) {
      const entry = byMember.get(session.userId) || {
        username: session.username,
        role: session.role,
        sessions: 0,
        totalSeconds: 0,
      };
      entry.sessions += 1;
      if (session.durationSeconds != null) entry.totalSeconds += session.durationSeconds;
      byMember.set(session.userId, entry);
    }

    const members = Array.from(byMember.entries())
      .map(([userId, value]) => ({ userId, ...value }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds);

    return NextResponse.json(
      {
        sessions,
        members,
        totals: {
          sessions: sessions.length,
          members: members.length,
          events: totalEvents,
          activeNow: sessions.filter((s) => s.closedBy === "open").length,
        },
      },
      { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message || "সেশন তথ্য আনতে সমস্যা হয়েছে।" },
      { status: 500 },
    );
  }
}
