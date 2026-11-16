import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSessionRaw } from "@/lib/auth";
import { recordActiveVisitor } from "@/lib/active-visitors";

// Throttle last_seen_at DB writes to at most once per 15 minutes per user
const lastSeenCache = new Map<string, number>();
const LAST_SEEN_THROTTLE_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  try {
    const { visitorId } = await req.json();
    const session = await getSessionRaw();

    const idToTrack = session?.id || visitorId || "anon";
    const activeOnline = recordActiveVisitor(idToTrack);

    // If user is logged in, update last_seen_at in Supabase DB at most once per 15m
    if (session?.id) {
      const now = Date.now();
      const lastSeen = lastSeenCache.get(session.id) || 0;
      if (now - lastSeen > LAST_SEEN_THROTTLE_MS) {
        lastSeenCache.set(session.id, now);
        try {
          const supabase = getSupabaseAdmin();
          await supabase
            .from("users")
            .update({ last_seen_at: new Date().toISOString() })
            .eq("id", session.id);
        } catch (e) {
          // Ignore if column is missing
        }
      }
    }

    return NextResponse.json({
      success: true,
      activeOnline,
    });
  } catch (e) {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
