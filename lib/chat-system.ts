/**
 * lib/chat-system.ts
 *
 * Posts a server-authored announcement into the global group chat.
 *
 * The chat UI already understands `is_system` rows (`chat_messages`), which
 * is what makes this a thin wrapper rather than a new subsystem: the message
 * simply appears in the same feed, styled as a system pill.
 *
 * Design notes:
 *  - `user_id` is `null` for system rows, so they never resolve to a profile
 *    and the UI can render them without an avatar or a profile link.
 *  - Every failure is swallowed and logged. Announcements are a nice-to-have;
 *    a missing `chat_messages` table (or a permission blip on a self-hosted
 *    Supabase) must NEVER fail the publish that triggered it. The caller
 *    keeps its success response either way.
 *  - Fire-and-forget: the function is awaited by callers for observability
 *    but its return value is only used for logging.
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import { getSiteConfig } from "@/lib/config";

/**
 * Look up the public slug of an item by its id.
 *
 * Announcements are posted from a dozen different publish paths, and each
 * of those knows the item's id but not necessarily its slug. Rather than
 * threading the slug through every call site, the announcement helper
 * resolves it here — one extra indexed read on a path that already writes
 * to the database.
 *
 * Returns null when the item has no public slug (published before the
 * rollout) or when the lookup fails.
 */
async function findPublicSlug(
  table: "stories" | "video_posts" | "picture_galleries",
  idColumn: "uid" | "id",
  id: string,
): Promise<string | null> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from(table)
      .select("public_slug")
      .eq(idColumn, id)
      .maybeSingle();
    if (error) return null;
    return (data as { public_slug?: string | null } | null)?.public_slug ?? null;
  } catch {
    return null;
  }
}

/** Marker identity for system rows — never a real user id. */
const SYSTEM_USER_ID = null;

/** The three publishable content kinds that get broadcasts. */
export type PublishKind = "story" | "video" | "picture";

/**
 * Canonical absolute URL for freshly published content.
 *
 * Shared by the chat announcements (below) and `lib/publish-broadcast.ts`
 * (which also posts to the community feed), so the chat message and the feed
 * post always link to the exact same place:
 *   story   → /golpo/<public-slug>   (legacy fallback: /<uid>)
 *   video   → /video/<public-slug>   (legacy fallback: /videos/<id>)
 *   picture → /image/<public-slug>   (legacy fallback: /pictures/<id>)
 *
 * Returns null when the id resolves to nothing usable.
 */
export async function resolvePublishHref(
  kind: PublishKind,
  id: string,
): Promise<string | null> {
  const raw = (id || "").trim().replace(/^\/+/, "");
  if (!raw) return null;

  const origin = siteOrigin();

  if (kind === "video") {
    const slug = await findPublicSlug("video_posts", "id", raw);
    const path = slug ? `/video/${slug}` : `/videos/${raw}`;
    return origin ? `${origin}${path}` : path;
  }

  if (kind === "picture") {
    const slug = await findPublicSlug("picture_galleries", "id", raw);
    const path = slug ? `/image/${slug}` : `/pictures/${raw}`;
    return origin ? `${origin}${path}` : path;
  }

  const slug = await findPublicSlug("stories", "uid", raw);
  const path = slug ? `/golpo/${slug}` : `/${raw}`;
  return origin ? `${origin}${path}` : path;
}

/**
 * Insert one system announcement into the global chat.
 *
 * @param text  Bengali announcement body. May contain a `/videos/<id>` link,
 *              which `ChatRoom` renders as a rich video preview card.
 * @returns true when the row was written, false otherwise (never throws).
 */
export async function postSystemChat(text: string): Promise<boolean> {
  const trimmed = (text || "").trim();
  if (!trimmed) return false;

  try {
    const { error } = await getSupabaseAdmin()
      .from("chat_messages")
      .insert({
        user_id: SYSTEM_USER_ID,
        username: "system",
        name: "সিস্টেম",
        profile_pic: null,
        message: trimmed,
        role: "system",
        is_system: true,
      });

    if (error) {
      // A missing table/column is a configuration state, not a crash —
      // log it once-ish and let the publish succeed regardless.
      console.warn("[chat-system] could not post announcement:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[chat-system] unexpected error:", (e as Error)?.message);
    return false;
  }
}

/**
 * The site's public origin, without a trailing slash.
 *
 * `getSiteConfig()` always falls back to the built-in default
 * (`https://chotikahini.vercel.app/`), so this is virtually never empty. The
 * try/catch only guards against a config read throwing in some future
 * server-context, in which case the caller falls back to a relative link.
 */
function siteOrigin(): string {
  try {
    const site = getSiteConfig();
    return (site.url || "").replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/**
 * Announcement for a newly published video.
 *
 * The link is absolute so `ChatRoom`'s URL matcher recognises it as a video
 * link and swaps in the rich player card rather than rendering bare text.
 */
export async function announceVideoPublished(
  videoId: string,
  title: string,
): Promise<boolean> {
  const id = (videoId || "").trim();
  if (!id) return false;

  const href = await resolvePublishHref("video", id);
  if (!href) return false;

  const safeTitle = (title || "").trim();
  const headline = safeTitle ? `নতুন ভিডিও: ${safeTitle}` : "নতুন ভিডিও প্রকাশিত হয়েছে";

  return postSystemChat(`${headline}\n${href}`);
}

/**
 * Announcement for a newly published picture gallery.
 *
 * Same shape as the video announcement: one headline line, one absolute
 * link. The link points at the gallery's own page, whose OpenGraph tags
 * carry the cover image — that is what makes `ChatRoom` render the rich
 * preview card with a thumbnail.
 */
export async function announcePicturePublished(
  galleryId: string,
  title: string,
): Promise<boolean> {
  const id = (galleryId || "").trim();
  if (!id) return false;

  const href = await resolvePublishHref("picture", id);
  if (!href) return false;

  const safeTitle = (title || "").trim();
  const headline = safeTitle
    ? `নতুন ছবির গ্যালারি: ${safeTitle}`
    : "নতুন গ্যালারি প্রকাশিত হয়েছে";

  return postSystemChat(`${headline}\n${href}`);
}

/**
 * Announcement for a newly published story.
 *
 * The argument is the story's uid (or slug). New public URLs put the
 * story at `/golpo/<public-slug>`; stories published before the rollout
 * keep their root `/{uid}` URL. The link is absolute so `ChatRoom` renders
 * the rich preview card with the story's cover image.
 */
export async function announceStoryPublished(
  storyPath: string,
  title: string,
): Promise<boolean> {
  const href = await resolvePublishHref("story", storyPath);
  if (!href) return false;

  const safeTitle = (title || "").trim();
  const headline = safeTitle
    ? `নতুন গল্প প্রকাশিত হয়েছে: "${safeTitle}"`
    : "নতুন গল্প প্রকাশিত হয়েছে";

  return postSystemChat(`${headline}\nপড়তে ভিজিট করুন: ${href}`);
}

