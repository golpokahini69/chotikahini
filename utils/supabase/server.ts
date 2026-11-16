import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

export async function createClient(cookieStore?: CookieStore) {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing Supabase env vars: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)."
    );
  }

  const store = cookieStore ?? (await cookies());

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            store.set(name, value, options)
          );
        } catch {
          // Called from a Server Component — safe to ignore because the
          // proxy refreshes sessions on every request.
        }
      },
    },
  });
}
