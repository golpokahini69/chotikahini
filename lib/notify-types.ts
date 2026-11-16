// ─────────────────────────────────────────────────────────────
// Single source of truth for notification `type` values and the
// per-role visibility allowlist.
//
// Previously the allowlist lived only in
// app/api/admin/notifications/route.ts while lib/notify.ts hardcoded
// its own type strings — two places to keep in sync, and they had
// already drifted. Everything now imports from here.
// ─────────────────────────────────────────────────────────────

export const NOTIFICATION_TYPES = {
  // Account lifecycle
  WELCOME: "welcome",
  NEW_USER_REGISTRATION: "new_user_registration",

  // Password reset
  FORGOT_PASSWORD_REQUEST: "forgot_password_request",
  PASSWORD_RESET_LINK_GENERATED: "password_reset_link_generated",
  PASSWORD_RESET_COMPLETED: "password_reset_completed",
  PASSWORD_RESET_BY_ADMIN: "password_reset_by_admin",

  // Content moderation / workflow
  DELETION_REQUEST: "deletion_request",
  VERIFICATION_REQUEST: "verification_request",
  VERIFICATION_APPROVED: "verification_approved",
  DUPLICATE_STORY_FLAG: "duplicate_story_flag",
  AUTHOR_APPROVED: "author_approved",
  AUTHOR_APPLICATION: "author_application",
  CONTACT_MESSAGE: "contact_message",
  COMMENT_REPORT: "comment_report",
  REPORT: "report",

  // Story workflow
  STORY_SUBMISSION: "story_submission",
  STORY_APPROVED: "story_approved",
  STORY_REVISION_REQUESTED: "story_revision_requested",
  STORY_REJECTED: "story_rejected",
  STORY_UNPUBLISHED: "story_unpublished",
  STORY_DELETED: "story_deleted",

  // Social
  REPLY: "reply",
  COMMENT_REPLY: "comment_reply",
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/**
 * Types whose `actor_id` is the USER the notification is about (as opposed
 * to the person who triggered it). The admin panel uses this to attach the
 * target user's id/email/username to the notification payload so the
 * "রিসেট লিঙ্ক তৈরি" action button has the id it needs.
 */
const USER_TARGETED_TYPES: string[] = [
  NOTIFICATION_TYPES.NEW_USER_REGISTRATION,
  NOTIFICATION_TYPES.FORGOT_PASSWORD_REQUEST,
  NOTIFICATION_TYPES.PASSWORD_RESET_LINK_GENERATED,
  NOTIFICATION_TYPES.PASSWORD_RESET_COMPLETED,
  NOTIFICATION_TYPES.PASSWORD_RESET_BY_ADMIN,
];

/** True when `type` refers to a notification about `userId` (the actor). */
export function isUserTargetedType(type: string | null | undefined): boolean {
  if (!type) return false;
  return USER_TARGETED_TYPES.includes(type);
}

/**
 * Which notification types each admin-tier role may see.
 *
 * `password_reset_*` and `forgot_password_request` are operational
 * (security) notifications — only full admins and superadmins see them.
 */
export const ROLE_NOTIF_TYPES: Record<string, string[]> = {
  superadmin: [
    NOTIFICATION_TYPES.DELETION_REQUEST,
    NOTIFICATION_TYPES.FORGOT_PASSWORD_REQUEST,
    NOTIFICATION_TYPES.PASSWORD_RESET_LINK_GENERATED,
    NOTIFICATION_TYPES.PASSWORD_RESET_COMPLETED,
    NOTIFICATION_TYPES.PASSWORD_RESET_BY_ADMIN,
    NOTIFICATION_TYPES.VERIFICATION_REQUEST,
    NOTIFICATION_TYPES.VERIFICATION_APPROVED,
    NOTIFICATION_TYPES.DUPLICATE_STORY_FLAG,
    NOTIFICATION_TYPES.NEW_USER_REGISTRATION,
    NOTIFICATION_TYPES.AUTHOR_APPROVED,
    NOTIFICATION_TYPES.AUTHOR_APPLICATION,
    NOTIFICATION_TYPES.CONTACT_MESSAGE,
    NOTIFICATION_TYPES.COMMENT_REPORT,
    NOTIFICATION_TYPES.REPORT,
    NOTIFICATION_TYPES.WELCOME,
  ],
  admin: [
    NOTIFICATION_TYPES.DELETION_REQUEST,
    NOTIFICATION_TYPES.FORGOT_PASSWORD_REQUEST,
    NOTIFICATION_TYPES.PASSWORD_RESET_LINK_GENERATED,
    NOTIFICATION_TYPES.PASSWORD_RESET_COMPLETED,
    NOTIFICATION_TYPES.PASSWORD_RESET_BY_ADMIN,
    NOTIFICATION_TYPES.VERIFICATION_REQUEST,
    NOTIFICATION_TYPES.VERIFICATION_APPROVED,
    NOTIFICATION_TYPES.DUPLICATE_STORY_FLAG,
    NOTIFICATION_TYPES.NEW_USER_REGISTRATION,
    NOTIFICATION_TYPES.AUTHOR_APPROVED,
    NOTIFICATION_TYPES.AUTHOR_APPLICATION,
    NOTIFICATION_TYPES.CONTACT_MESSAGE,
    NOTIFICATION_TYPES.COMMENT_REPORT,
    NOTIFICATION_TYPES.REPORT,
    NOTIFICATION_TYPES.WELCOME,
  ],
  content_manager: [
    NOTIFICATION_TYPES.AUTHOR_APPROVED,
    NOTIFICATION_TYPES.VERIFICATION_APPROVED,
    NOTIFICATION_TYPES.COMMENT_REPORT,
    NOTIFICATION_TYPES.REPORT,
    NOTIFICATION_TYPES.WELCOME,
  ],
  moderator: [
    NOTIFICATION_TYPES.COMMENT_REPORT,
    NOTIFICATION_TYPES.REPORT,
  ],
};

/**
 * Notification types a regular (non-admin) user can receive.
 * The user-facing bell renders these; the admin panel allowlist above
 * is deliberately separate.
 */
export const USER_NOTIF_TYPES: string[] = [
  NOTIFICATION_TYPES.WELCOME,
  NOTIFICATION_TYPES.PASSWORD_RESET_LINK_GENERATED,
  NOTIFICATION_TYPES.PASSWORD_RESET_COMPLETED,
  NOTIFICATION_TYPES.PASSWORD_RESET_BY_ADMIN,
  NOTIFICATION_TYPES.STORY_APPROVED,
  NOTIFICATION_TYPES.STORY_REVISION_REQUESTED,
  NOTIFICATION_TYPES.STORY_REJECTED,
  NOTIFICATION_TYPES.STORY_UNPUBLISHED,
  NOTIFICATION_TYPES.STORY_DELETED,
  NOTIFICATION_TYPES.REPLY,
  NOTIFICATION_TYPES.COMMENT_REPLY,
  NOTIFICATION_TYPES.AUTHOR_APPROVED,
];
