import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";

// Canonicalization: the site lives at chotikahini.vercel.app.
// If requests arrive with the old domain or www, forward with a 301.
const CANONICAL_HOST = "chotikahini.vercel.app";

export async function proxy(request: NextRequest) {
  const rawHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const host = rawHost.toLowerCase().replace(/:\d+$/, "");

  const isOldDomain = host === "golopokahini.lol" || host === "www.golopokahini.lol" || host === `www.${CANONICAL_HOST}`;

  if (isOldDomain) {
    const url = request.nextUrl.clone();
    url.protocol = "https";
    url.host = CANONICAL_HOST;
    url.port = "";
    return NextResponse.redirect(url, { status: 301 });
  }

  // Keeps the Supabase auth session fresh. Anonymous requests are a no-op.
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files (_next, favicon, images)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
