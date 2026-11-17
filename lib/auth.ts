import { cache } from "react";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "./supabase";

const DEFAULT_JWT_SECRET = "default_fallback_secret_do_not_use_in_prod";
const RAW_JWT_SECRET = process.env.JWT_SECRET || "";
const JWT_SECRET = RAW_JWT_SECRET || DEFAULT_JWT_SECRET;

if (process.env.NODE_ENV === "production" && (!RAW_JWT_SECRET || RAW_JWT_SECRET === DEFAULT_JWT_SECRET)) {
  // Hard fail in production — running with a default JWT secret would let
  // any attacker forge a valid superadmin session.
  throw new Error(
    "[FATAL] JWT_SECRET is missing or set to the default value. " +
      "Set a strong random secret in your environment before deploying to production."
  );
}

if (process.env.NODE_ENV !== "production" && !RAW_JWT_SECRET) {
  console.warn(
    "[SECURITY WARNING] JWT_SECRET is not defined — using a development default. " +
      "DO NOT deploy to production with this configuration."
  );
}

const encodedSecret = new TextEncoder().encode(JWT_SECRET);

export interface UserSessionPayload {
  id: string;
  username: string;
  name?: string;
  email?: string;
  profilePic?: string;
  bio?: string;
  savedPosts?: string[];
  createdAt?: string;
  role?: "user" | "author" | "admin" | "superadmin" | "content_manager" | "moderator";
  isVerified?: boolean;
}

/**
 * Hydrates live user details (role, name, avatar) from DB so permissions take effect immediately.
 */
async function hydrateSessionUser(base: UserSessionPayload): Promise<UserSessionPayload> {
  if (!base?.id) return base;
  try {
    const supabase = getSupabaseAdmin();
    const { data: liveUser } = await supabase
      .from("users")
      .select("id, username, name, profile_pic, saved_posts, role, is_verified")
      .eq("id", base.id)
      .maybeSingle();

    if (liveUser) {
      return {
        ...base,
        username: liveUser.username || base.username,
        name: liveUser.name || base.name,
        profilePic: liveUser.profile_pic || base.profilePic,
        savedPosts: liveUser.saved_posts || base.savedPosts || [],
        role: liveUser.role || base.role || "user",
        isVerified: liveUser.is_verified === true,
      };
    }
  } catch (e) {
    // DB unreachable — fall back to JWT payload
  }
  return base;
}

/**
 * Creates a signed JWT and sets it in an HTTP-only cookie.
 */
export async function setSession(user: UserSessionPayload) {
  const token = await new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d") // 30 days session
    .sign(encodedSecret);

  // Next.js 15+ made `cookies()` async — it must be awaited before the
  // cookie store is accessed.
  const cookieStore = await cookies();
  cookieStore.set("user_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

/**
 * Clears the session cookie.
 */
export async function clearSession() {
  // Next.js 15+ made `cookies()` async.
  const cookieStore = await cookies();
  cookieStore.delete("user_session");
}

/**
 * Verify + hydrate, memoised per request on the token string.
 *
 * Route handlers call `getSession()` several times in one request (the
 * comments route alone calls it 4×), and every call used to re-verify the
 * JWT and re-read the user row from PostgREST — so ONE API request could
 * cost four database round-trips for a logged-in user.
 *
 * React's `cache()` is scoped to the current request, so:
 *   • within a request → one jwtVerify + one `users` read, shared by all
 *     callers of getSession();
 *   • across requests  → a fresh result, so role changes still take effect
 *     immediately (the entire reason hydrateSessionUser exists).
 *
 * The same `cache()` already backs `getAllPostsAsync` in this app's route
 * handlers, so request-scoping here is proven, not assumed.
 */
const verifyAndHydrate = cache(async (token: string): Promise<UserSessionPayload | null> => {
  try {
    const { payload } = await jwtVerify(token, encodedSecret);
    const base = payload as unknown as UserSessionPayload;
    return await hydrateSessionUser(base);
  } catch (error) {
    return null;
  }
});

/**
 * Verifies the JWT and returns the payload if valid with live DB role.
 * Deduplicated per request on the token — see verifyAndHydrate above.
 */
export async function getSession(): Promise<UserSessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("user_session")?.value;
  if (!token) return null;
  return verifyAndHydrate(token);
}

/**
 * Verifies the JWT and returns the payload WITHOUT hitting the database.
 *
 * `getSession()` re-reads the user row on every call so that role changes
 * take effect immediately. That is correct for authorization decisions,
 * but on hot write paths (analytics tracking, heartbeats) it adds a
 * Supabase round-trip to every single request just to learn a user id
 * that the signed token already carries.
 *
 * Use this only where the result is NOT used to make an authorization
 * decision. Never use it for admin/permission checks.
 */
export async function getSessionRaw(): Promise<UserSessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("user_session")?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, encodedSecret);
    return payload as unknown as UserSessionPayload;
  } catch (error) {
    return null;
  }
}

/**
 * Helper to get the session from an incoming NextRequest with live DB role.
 */
export async function getSessionFromRequest(req: NextRequest): Promise<UserSessionPayload | null> {
  const token = req.cookies.get("user_session")?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, encodedSecret);
    const base = payload as unknown as UserSessionPayload;
    return await hydrateSessionUser(base);
  } catch (error) {
    return null;
  }
}
