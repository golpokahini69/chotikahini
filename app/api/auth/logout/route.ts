import { NextResponse } from "next/server";
import { clearSession, getSession } from "@/lib/auth";
import { recordAuthEvent } from "@/lib/auth-tracking";

export async function POST(req: Request) {
  // Read the session BEFORE clearing it — the tracking row needs to know who
  // just logged out. `clearSession` removes the cookie, so this order matters.
  const session = await getSession().catch(() => null);

  // `clearSession` is async (Next.js 15+ made `cookies()` async). It MUST be
  // awaited — otherwise the response is sent before the cookie is cleared and
  // the user stays logged in.
  await clearSession();

  if (session?.id) {
    await recordAuthEvent(req, "logout", {
      id: session.id,
      username: session.username || session.name,
      role: session.role,
    });
  }

  return NextResponse.json({ success: true });
}
