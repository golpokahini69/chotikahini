import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function readConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";
  return { supabaseUrl, supabaseKey };
}

export function isConfigured() {
  const { supabaseUrl, supabaseKey } = readConfig();
  return Boolean(supabaseUrl && supabaseKey);
}

/**
 * Returns true when the request carries a Supabase auth cookie. Anonymous
 * visitors never hit the network here, which keeps proxy latency at ~0 for
 * normal page loads.
 */
export function hasAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("auth-token"));
}

/**
 * Refreshes the Supabase auth session for the incoming request and returns a
 * response carrying any rotated cookies. The returned response must be the one
 * handed back from the proxy so the browser persists the new tokens.
 */
export async function updateSession(request: NextRequest) {
  const { supabaseUrl, supabaseKey } = readConfig();

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Only touch the network when a session cookie exists. `getUser` validates
  // the token against Supabase and triggers the refresh path above.
  if (hasAuthCookie(request)) {
    try {
      await supabase.auth.getUser();
    } catch {
      // Network/auth errors must never break navigation; the request simply
      // continues with unrefreshed cookies.
    }
  }

  return supabaseResponse;
}
