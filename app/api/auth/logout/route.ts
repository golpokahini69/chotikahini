import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";

export async function POST() {
  // `clearSession` is async (Next.js 15+ made `cookies()` async). It MUST be
  // awaited — otherwise the response is sent before the cookie is cleared and
  // the user stays logged in.
  await clearSession();
  return NextResponse.json({ success: true });
}
