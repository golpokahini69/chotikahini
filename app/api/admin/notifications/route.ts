import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { getSiteConfig } from "@/lib/config";
import { getRealAdminIds } from "@/lib/notify";
import { ROLE_NOTIF_TYPES, NOTIFICATION_TYPES, isUserTargetedType } from "@/lib/notify-types";

// ── Role-scoped notification visibility ──────────────────────
// Every admin-tier role only sees the notifications its role is
// responsible for. Nothing outside the role's domain is exposed.
//
// The per-role allowlist lives in lib/notify-types.ts so the API route
// and lib/notify.ts can never drift apart.

/**
 * Resolve the real admin/superadmin user ids from the database.
 *
 * Never hardcodes ids like "admin-1" or "superadmin": `notifications.user_id`
 * has a FOREIGN KEY to `users(id)`, and notifications are also filtered by
 * `user_id`, so fake ids in the scope would either break the FK or silently
 * widen the query. The real ids come from the DB — `getRealAdminIds` only
 * includes the env superadmin id when a row for it actually exists.
 */
let adminIdsCache: { ids: string[]; at: number } | null = null;

async function resolveAdminIds(supabase: any): Promise<string[]> {
  // Short memo: the badge poll hits this route often. Ids only change when an
  // admin account is created/removed — 60s of staleness is invisible there
  // and saves one users read per poll.
  if (adminIdsCache && Date.now() - adminIdsCache.at < 60_000) {
    return adminIdsCache.ids;
  }
  const ids = await getRealAdminIds(supabase);
  adminIdsCache = { ids, at: Date.now() };
  return ids;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const role = session.role || "user";
    const allowedTypes = ROLE_NOTIF_TYPES[role];
    if (!allowedTypes) {
      return NextResponse.json({ notifications: [] });
    }

    const supabase = getSupabaseAdmin();
    const adminIds = await resolveAdminIds(supabase);

    // ── Fast badge path ──────────────────────────────────────────────────
    // `?count=1` answers "how many unread?" with ONE head-count: no rows, no
    // user join, no JSON mapping. The dashboard's periodic badge refresh uses
    // this instead of re-downloading the whole notification list every 30s.
    // Same scoping as the full read (role allowlist + admin/session ids).
    if (new URL(req.url).searchParams.get("count") === "1") {
      const { count, error: countError } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .or(`user_id.in.(${[...adminIds, session.id].join(",")})`)
        .in("type", allowedTypes)
        .eq("is_read", false);
      if (countError) throw countError;
      return NextResponse.json(
        { unreadCount: count || 0 },
        { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } },
      );
    }

    // Only notifications the role is entitled to see (by type) AND that are
    // bound to admin recipients or this specific user.
    const { data: notifications, error } = await supabase
      .from("notifications")
      .select("*")
      .or(`user_id.in.(${[...adminIds, session.id].join(",")})`)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    // The role-domain filter now runs HERE, in JS, on the same bounded set
    // (limit 100), instead of inside the SQL. Same rows delivered — but the
    // response can now report HOW MANY were withheld by the role allowlist,
    // so "notifications exist but the panel shows fewer" is visible instead
    // of silent. (Previously `.in("type", …)` made the API return a shorter
    // list with no hint that anything was filtered.)
    const allowed = new Set(allowedTypes);
    const scopedRows = notifications || [];
    const inDomain = scopedRows.filter((n) => allowed.has(n.type));
    const hiddenCount = scopedRows.length - inDomain.length;

    // Resolve the user each notification is ABOUT. For user-targeted types
    // (new_user_registration, forgot_password_request, password_reset_*)
    // the `actor_id` IS the target user's id — the admin panel needs it to
    // render actionable buttons (e.g. "রিসেট লিঙ্ক তৈরি" needs the id).
    const targetUserIds = Array.from(
      new Set(
        inDomain
          .filter((notification) => isUserTargetedType(notification.type) && notification.actor_id)
          .map((notification) => notification.actor_id as string),
      ),
    );
    const targetUsersById = new Map<
      string,
      { name: string; email: string; username: string }
    >();

    if (targetUserIds.length > 0) {
      const { data: targetUsers, error: usersError } = await supabase
        .from("users")
        .select("id, name, email, username")
        .in("id", targetUserIds);
      if (usersError) throw usersError;
      for (const user of targetUsers || []) {
        targetUsersById.set(user.id, {
          name: user.name || "",
          email: user.email || "",
          username: user.username || "",
        });
      }
    }

    const site = getSiteConfig();
    const siteName = site.seo?.siteName || site.title || "আমাদের প্ল্যাটফর্ম";
    const mapped = inDomain.map((n) => {
      let payload: any = {};
      try {
        if (n.snippet && n.snippet.startsWith("{")) {
          payload = JSON.parse(n.snippet);
        }
      } catch (e) {}

      const registrationUser = n.type === NOTIFICATION_TYPES.NEW_USER_REGISTRATION
        ? targetUsersById.get(n.actor_id)
        : undefined;
      const welcomeName = registrationUser?.name || n.actor_name || "বন্ধু";

      // For any user-targeted notification, expose the target user's id and
      // contact details so the admin can act on it without a second lookup.
      // (Previously `data.userId` was only set for new_user_registration, so
      // the "রিসেট লিঙ্ক তৈরি" button on a forgot_password_request
      // notification always failed with "ইউজার আইডি পাওয়া যায়নি".)
      const targetUser = isUserTargetedType(n.type)
        ? targetUsersById.get(n.actor_id)
        : undefined;

      return {
        id: n.id,
        type: n.type || "general",
        userId: n.user_id,
        actorId: n.actor_id,
        title: n.actor_name || "সিস্টেম নোটিফিকেশন",
        message: payload.message || payload.message_text || n.snippet || "",
        data: {
          ...payload,
          ...(n.actor_id && isUserTargetedType(n.type)
            ? {
                userId: n.actor_id,
                name: targetUser?.name || n.actor_name || "বন্ধু",
                email: targetUser?.email || "",
                username: targetUser?.username || "",
              }
            : {}),
          ...(registrationUser
            ? {
                welcomeMessage:
                  `প্রিয় ${welcomeName},\n\n` +
                  `${siteName}-এ আপনাকে স্বাগতম! আপনার অ্যাকাউন্ট তৈরি হয়েছে। ` +
                  "এখানে আপনার পছন্দের গল্প পড়ুন, লেখকদের সঙ্গে যুক্ত থাকুন, আর চাইলে নিজের গল্পও শেয়ার করুন।\n\n" +
                  `শুভেচ্ছান্তে,\n${siteName} টিম`,
              }
            : {}),
        },
        isRead: Boolean(n.is_read),
        createdAt: n.created_at,
      };
    });

    return NextResponse.json({
      notifications: mapped,
      // Rows addressed to this admin but outside their role's domain (e.g.
      // author-scoped story events sent to an admin who is also an author).
      // Surfaced so the panel can say they exist rather than hiding them.
      hiddenCount,
      totalAddressed: scopedRows.length,
    });
  } catch (error) {
    console.error("Failed to fetch admin notifications:", error);
    return NextResponse.json({ notifications: [] }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const role = session.role || "user";
    const allowedTypes = ROLE_NOTIF_TYPES[role];
    if (!allowedTypes) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const supabase = getSupabaseAdmin();
    const adminIds = await resolveAdminIds(supabase);
    const scope = `user_id.in.(${[...adminIds, session.id].join(",")})`;

    if (body.all) {
      // supabase-js resolves on failure instead of rejecting, so the
      // `error` MUST be inspected — otherwise the admin sees "success"
      // while nothing was actually marked read.
      const { error: allError } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .or(scope)
        .in("type", allowedTypes)
        .eq("is_read", false);
      if (allError) throw allError;
    } else if (body.id) {
      // Single-item update MUST be scoped exactly like the GET — otherwise an
      // admin could mark-read ANY notification id in the system, including
      // ones belonging to ordinary users. Previously this filtered by `id`
      // alone, which was a privilege-escalation bug.
      const { data: updated, error: updateError } = await supabase
        .from("notifications")
        .update({ is_read: Boolean(body.isRead) })
        .eq("id", body.id)
        .in("user_id", [...adminIds, session.id])
        .in("type", allowedTypes)
        .select("id")
        .maybeSingle();

      if (updateError) throw updateError;

      if (!updated) {
        return NextResponse.json({ error: "Notification not found" }, { status: 404 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to update notification" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const role = session.role || "user";
    const allowedTypes = ROLE_NOTIF_TYPES[role];
    if (!allowedTypes) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const adminIds = await resolveAdminIds(supabase);
    const scope = `user_id.in.(${[...adminIds, session.id].join(",")})`;

    if (id === "all") {
      // Same rule as the PATCH branch: inspect the resolved error instead
      // of assuming the bulk delete succeeded.
      const { error: allError } = await supabase
        .from("notifications")
        .delete()
        .or(scope)
        .in("type", allowedTypes);
      if (allError) throw allError;
    } else if (id) {
      // Single-item delete MUST be scoped exactly like the GET — otherwise an
      // admin could delete ANY notification id in the system, including ones
      // belonging to ordinary users. Previously this filtered by `id` alone.
      const { data: deleted, error: deleteError } = await supabase
        .from("notifications")
        .delete()
        .eq("id", id)
        .in("user_id", [...adminIds, session.id])
        .in("type", allowedTypes)
        .select("id")
        .maybeSingle();

      if (deleteError) throw deleteError;

      if (!deleted) {
        return NextResponse.json({ error: "Notification not found" }, { status: 404 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to delete notification" }, { status: 500 });
  }
}
