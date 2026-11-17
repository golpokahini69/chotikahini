import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * lib/auth-tracking.ts
 *
 * Records "member X logged in at HH:MM and logged out at HH:MM" so the admin
 * panel can answer both questions.
 *
 * ── Why `admin_audit_logs` and not a new table ──────────────────────────
 * The live database has no login/session table, and running a migration is a
 * manual step the owner would have to perform. `admin_audit_logs` already
 * exists there (id, actor_id, actor_username, action, target_type, target_id,
 * prev_state, new_state, created_at) and is exactly the right shape: one
 * append-only row per event with a JSONB payload. So an auth event is written
 * as:
 *
 *   action         "auth.login" | "auth.logout"
 *   actor_id       the member's users.id
 *   actor_username their username
 *   target_type    "session"
 *   new_state      { ip, userAgent, role }
 *
 * Session duration = the gap between a login row and the next logout row for
 * the same actor (see `getMemberSessions`). If a member closes the tab
 * without logging out, the logout row is missing and the duration is derived
 * from their next login (bounded), which is reported as "ended by next login".
 *
 * Everything here FAILS OPEN: tracking must never break login or logout.
 */

export type AuthEventKind = "login" | "logout";

export interface SessionActivity {
  /** users.id */
  userId: string;
  username: string;
  role: string;
  loginAt: string;
  logoutAt: string | null;
  /** Duration in seconds; null while the session is still open. */
  durationSeconds: number | null;
  ip: string | null;
  userAgent: string | null;
  /** "logout" | "next_login" | "open" — how this session was closed. */
  closedBy: "logout" | "next_login" | "open";
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || null;
  return req.headers.get("x-real-ip") || null;
}

function shortUserAgent(ua: string | null): string | null {
  if (!ua) return null;
  // Keep it readable in the panel: browser + platform, no full UA string.
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\//.test(ua) ? "Opera" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Safari\//.test(ua) ? "Safari" :
    /Firefox\//.test(ua) ? "Firefox" :
    /curl|bot|crawl/i.test(ua) ? "Bot" : "অন্যান্য";
  const platform =
    /Android/.test(ua) ? "Android" :
    /iPhone|iPad/.test(ua) ? "iOS" :
    /Mac OS X/.test(ua) ? "macOS" :
    /Windows/.test(ua) ? "Windows" :
    /Linux/.test(ua) ? "Linux" : "";
  return platform ? `${browser} · ${platform}` : browser;
}

/**
 * Record one auth event. Never throws.
 *
 * The actor id is the member's `users.id`; `admin_audit_logs.actor_id` has no
 * FK constraint (it is plain text in the DDL), so ordinary members are fine.
 */
export async function recordAuthEvent(
  req: Request,
  kind: AuthEventKind,
  actor: { id: string; username?: string | null; role?: string | null },
): Promise<void> {
  if (!actor?.id) return;
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from("admin_audit_logs").insert({
      actor_id: actor.id,
      actor_username: actor.username || null,
      action: `auth.${kind}`,
      target_type: "session",
      target_id: actor.id,
      new_state: {
        ip: clientIp(req),
        userAgent: shortUserAgent(req.headers.get("user-agent")),
        role: actor.role || "user",
      },
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("[auth-tracking] could not record", kind, (e as Error)?.message);
  }
}

/**
 * Build the session list for the admin tracking section.
 *
 * @param opts.userId   only this member (optional)
 * @param opts.sinceDays look-back window, default 7
 * @param opts.limit    max sessions returned, default 200
 */
export async function getMemberSessions(opts?: {
  userId?: string | null;
  sinceDays?: number;
  limit?: number;
}): Promise<{ sessions: SessionActivity[]; totalEvents: number }> {
  const sinceDays = Math.min(Math.max(opts?.sinceDays ?? 7, 1), 90);
  const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 500);
  const sinceIso = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("admin_audit_logs")
      .select("actor_id, actor_username, action, new_state, created_at")
      .in("action", ["auth.login", "auth.logout"])
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .limit(2000);

    if (opts?.userId) query = query.eq("actor_id", opts.userId);

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data || []) as Array<{
      actor_id: string;
      actor_username: string | null;
      action: string;
      new_state: { ip?: string | null; userAgent?: string | null; role?: string | null } | null;
      created_at: string;
    }>;

    // Pair logins with the next logout per actor, in chronological order.
    const openByActor = new Map<string, number>();
    const sessions: SessionActivity[] = [];

    for (const row of rows) {
      const isLogin = row.action === "auth.login";
      const at = new Date(row.created_at).getTime();

      if (isLogin) {
        // A still-open session followed by a new login: close it here.
        const prevIndex = openByActor.get(row.actor_id);
        if (prevIndex !== undefined) {
          const prev = sessions[prevIndex];
          const seconds = Math.max(0, Math.round((at - new Date(prev.loginAt).getTime()) / 1000));
          prev.logoutAt = row.created_at;
          prev.durationSeconds = seconds;
          prev.closedBy = "next_login";
        }
        sessions.push({
          userId: row.actor_id,
          username: row.actor_username || row.new_state?.role || row.actor_id,
          role: row.new_state?.role || "user",
          loginAt: row.created_at,
          logoutAt: null,
          durationSeconds: null,
          ip: row.new_state?.ip || null,
          userAgent: row.new_state?.userAgent || null,
          closedBy: "open",
        });
        openByActor.set(row.actor_id, sessions.length - 1);
      } else {
        const index = openByActor.get(row.actor_id);
        if (index === undefined) continue; // logout without a seen login
        const session = sessions[index];
        const seconds = Math.max(0, Math.round((at - new Date(session.loginAt).getTime()) / 1000));
        session.logoutAt = row.created_at;
        session.durationSeconds = seconds;
        session.closedBy = "logout";
        openByActor.delete(row.actor_id);
      }
    }

    sessions.sort((a, b) => new Date(b.loginAt).getTime() - new Date(a.loginAt).getTime());
    return { sessions: sessions.slice(0, limit), totalEvents: rows.length };
  } catch (e) {
    console.warn("[auth-tracking] sessions query failed:", (e as Error)?.message);
    return { sessions: [], totalEvents: 0 };
  }
}
