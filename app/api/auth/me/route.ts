import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = 'force-dynamic';

/**
 * Session heartbeat + "who am I".
 *
 * The client calls this on load and after auth changes. As a side effect it
 * refreshes `users.last_seen_at`, which is what the admin panel's login
 * activity section uses to tell an OPEN session that is still here from one
 * that was abandoned without logging out.
 *
 * The write is THROTTLED in-process (per user, 60s): `last_seen_at` only
 * needs minute-level accuracy for a "how long were they active" report, and
 * unthrottled writes would put a database round-trip behind every page load.
 * The throttle is per serverless instance, so the worst case is one extra
 * write per instance per minute — cheap, and it never fails the request.
 */
const lastSeenWriteAt = new Map<string, number>();
const LAST_SEEN_THROTTLE_MS = 60_000;

async function touchLastSeen(userId: string): Promise<void> {
  if (!userId) return;
  const last = lastSeenWriteAt.get(userId) || 0;
  if (Date.now() - last < LAST_SEEN_THROTTLE_MS) return;
  lastSeenWriteAt.set(userId, Date.now());
  if (lastSeenWriteAt.size > 5000) lastSeenWriteAt.clear();

  try {
    await getSupabaseAdmin()
      .from("users")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", userId);
  } catch {
    /* heartbeat is best-effort — never fail /me over it */
  }
}

export async function GET() {
  const session = await getSession();
  
  if (!session) {
    return NextResponse.json({ user: null });
  }

  // Fire-and-forget: the response must not wait on the heartbeat write.
  void touchLastSeen(session.id);

  return NextResponse.json({
    user: {
      id: session.id,
      username: session.username,
      name: session.name,
      email: session.email,
      profilePic: session.profilePic,
      savedPosts: session.savedPosts || [],
      createdAt: session.createdAt,
      role: session.role,
      isVerified: session.isVerified
    }
  });
}
