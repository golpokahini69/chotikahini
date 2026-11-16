/**
 * Shared scheduling helpers for the video + picture sections.
 *
 * Both media tables schedule a post the same way, so the logic lives here
 * instead of being copy-pasted into both admin API routes:
 *
 *   scheduled_at   when the post is meant to go live
 *   published_at   when it actually went live
 *
 * For a scheduled row we deliberately write `status = 'published'` and
 * `published_at = <the future timestamp>`. Every public read path already
 * filters on `published_at <= now()` (see lib/videos.ts, lib/pictures.ts,
 * app/(bn)/videos/[videoId]/page.tsx), so the row stays invisible until its
 * time arrives. The cron route then clears `scheduled_at` and announces it.
 */

/** A parsed schedule request from an admin form. */
export interface ParsedSchedule {
  /** Normalised ISO timestamp, or null when there is no (valid) schedule. */
  iso: string | null;
  /** True when the timestamp lies in the future. */
  isFuture: boolean;
}

/**
 * Parse a `scheduledAt` value coming from the admin form.
 *
 * Accepts an ISO string (what the client sends) and also a
 * `datetime-local` value ("2026-10-31T18:30") for robustness. Anything
 * unparseable is treated as "no schedule" rather than an error — an empty
 * or malformed field should never block a publish.
 */
export function parseScheduledAt(raw: unknown): ParsedSchedule {
  const now = Date.now();

  if (typeof raw !== "string") return { iso: null, isFuture: false };
  const value = raw.trim();
  if (!value) return { iso: null, isFuture: false };

  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return { iso: null, isFuture: false };

  const iso = parsed.toISOString();
  return { iso, isFuture: parsed.getTime() > now };
}

/**
 * The publish-related columns for a row, derived from the schedule.
 *
 * `status` is one of the three values the tables allow:
 *   - "published" — live now, or live once the scheduled moment arrives
 *   - "draft"     — hidden until an admin publishes it
 *
 * `scheduled_at` is kept in sync with `published_at` so the admin UI can
 * tell "scheduled for later" apart from "already live".
 */
export interface PublishState {
  status: "published" | "draft";
  published_at: string | null;
  scheduled_at: string | null;
}

/**
 * Work out the publish columns for a create/update.
 *
 * `scheduledAt` is the raw value from the request:
 *   - a valid timestamp → the row is scheduled for that moment
 *   - null / empty / invalid → publish immediately
 *
 * `draft` flips the row back to hidden (the "ড্রাফট করুন" action).
 */
export function resolvePublishState({
  scheduledAt,
  draft = false,
}: {
  scheduledAt?: unknown;
  draft?: boolean;
}): PublishState {
  if (draft) {
    return { status: "draft", published_at: null, scheduled_at: null };
  }

  const { iso, isFuture } = parseScheduledAt(scheduledAt);
  if (iso && isFuture) {
    // The public pages hide it until `published_at` catches up with now.
    return { status: "published", published_at: iso, scheduled_at: iso };
  }

  // No schedule (or one in the past) → publish right away.
  return {
    status: "published",
    published_at: new Date().toISOString(),
    scheduled_at: null,
  };
}

/**
 * Tri-state handling for PATCH requests.
 *
 * The client sends one of:
 *   - an ISO string → set / reschedule
 *   - null          → clear the schedule (publish now)
 *   - absent        → leave the existing schedule untouched
 *
 * `undefined` in the result means "don't touch the column".
 */
export type SchedulePatch = string | null | undefined;

/**
 * Turn a tri-state `scheduledAt` into the columns to write.
 *
 * When the schedule is being cleared we publish immediately, because
 * "remove the schedule" means "I want this live, not waiting".
 */
export function resolveSchedulePatch(
  scheduledAt: SchedulePatch,
): Partial<PublishState> {
  if (scheduledAt === undefined) return {};

  if (scheduledAt === null) {
    return {
      status: "published",
      published_at: new Date().toISOString(),
      scheduled_at: null,
    };
  }

  const { iso, isFuture } = parseScheduledAt(scheduledAt);
  if (!iso) {
    // Unparseable — treat as a cleared schedule rather than failing the
    // whole save over one field.
    return {
      status: "published",
      published_at: new Date().toISOString(),
      scheduled_at: null,
    };
  }

  if (!isFuture) {
    // A time in the past means "publish now", not "schedule it retroactively".
    return {
      status: "published",
      published_at: new Date().toISOString(),
      scheduled_at: null,
    };
  }

  return { status: "published", published_at: iso, scheduled_at: iso };
}

/** True when the row is scheduled for a moment that has not arrived yet. */
export function isScheduledRow(row: {
  status?: string | null;
  scheduled_at?: string | null;
  published_at?: string | null;
}): boolean {
  if (row.status !== "published") return false;
  if (!row.scheduled_at) return false;
  return new Date(row.scheduled_at).getTime() > Date.now();
}
