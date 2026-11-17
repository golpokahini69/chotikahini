/**
 * lib/publish-broadcast.ts
 *
 * What happens the instant content goes LIVE: the global chat gets a system
 * message AND the community feed gets an auto post — one helper, fired
 * together, from every publish path (manual approve, direct publish,
 * scheduled cron go-live).
 *
 * Rules:
 *   • Only real go-live moments call this (pending → published, create
 *     published, scheduled → due). Routine edits of already-live content
 *     must NOT re-broadcast — each caller owns that transition check, since
 *     only the caller knows the previous status.
 *   • Both outputs run concurrently (`Promise.all`) so the chat message and
 *     the feed post land together, immediately after the row is written.
 *   • Nothing throws: chat/feed trouble must never roll back a publish —
 *     every failure is logged and swallowed (same contract as
 *     `lib/chat-system.ts`).
 *   • The feed post is authored by the acting user (the admin/author who
 *     published). Cron runs without a session, so it falls back to the
 *     site's oldest superadmin/admin account, memoised for 10 minutes.
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import {
  type PublishKind,
  resolvePublishHref,
  announceStoryPublished,
  announceVideoPublished,
  announcePicturePublished,
} from "@/lib/chat-system";

export type { PublishKind };

export interface BroadcastInput {
  kind: PublishKind;
  /** story uid | video id | picture gallery id */
  id: string;
  title: string;
  /** Account the feed post appears under; omitted → cron fallback poster. */
  actorId?: string | null;
}

let posterFallback: { id: string; at: number } | null = null;

async function resolvePosterId(actorId?: string | null): Promise<string | null> {
  if (actorId) return actorId;
  if (posterFallback && Date.now() - posterFallback.at < 10 * 60 * 1000) {
    return posterFallback.id;
  }
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("users")
      .select("id")
      .in("role", ["superadmin", "admin"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    const id = (data as { id?: string } | null)?.id || null;
    if (id) posterFallback = { id, at: Date.now() };
    return id;
  } catch {
    return null;
  }
}

/**
 * Community-feed auto post for one published item.
 *
 * Content per kind:
 *   story   → headline + the feed's rich story card (story_slug/title/cover)
 *   video   → headline + absolute video URL, which `resolveVideosInText`
 *             renders as an inline player in the timeline
 *   picture → headline + absolute gallery URL (link card via OG tags)
 */
async function createFeedPost(
  kind: PublishKind,
  id: string,
  title: string,
  href: string | null,
  actorId?: string | null,
): Promise<void> {
  try {
    const posterId = await resolvePosterId(actorId);
    if (!posterId || !href) return;

    const supabase = getSupabaseAdmin();
    const safeTitle = (title || "").trim();

    // Who is this content by? Stories show their author; media shows the
    // uploading admin/uploader. Resolved here so the timeline post reads like
    // a real announcement ("… — লেখক: X") instead of an anonymous link.
    let byline = "";
    if (kind === "story") {
      const { data } = await supabase
        .from("stories")
        .select("author_id")
        .eq("uid", id)
        .maybeSingle();
      const authorId = (data as { author_id?: string } | null)?.author_id;
      if (authorId) {
        const { data: author } = await supabase
          .from("users")
          .select("name, username")
          .eq("id", authorId)
          .maybeSingle();
        const name =
          (author as { name?: string } | null)?.name ||
          (author as { username?: string } | null)?.username;
        if (name) byline = `\nলেখক: ${name}`;
      }
    }

    const content =
      kind === "story"
        ? safeTitle
          ? `নতুন গল্প প্রকাশ হয়েছে — "${safeTitle}"${byline}`
          : `নতুন গল্প প্রকাশ হয়েছে${byline}`
        : kind === "video"
          ? safeTitle
            ? `নতুন ভিডিও এসেছে — "${safeTitle}"${byline}\n${href}`
            : `নতুন ভিডিও প্রকাশিত হয়েছে${byline}\n${href}`
          : safeTitle
            ? `নতুন ছবির গ্যালারি — "${safeTitle}"${byline}\n${href}`
            : `নতুন গ্যালারি প্রকাশিত হয়েছে${byline}\n${href}`;

    const payload: Record<string, unknown> = {
      user_id: posterId,
      content,
      status: "published",
    };

    if (kind === "story") {
      // Attach the story so the timeline renders the rich story card
      // (same shape the community composer produces for attached stories).
      const { data: story } = await supabase
        .from("stories")
        .select("slug, title, cover")
        .eq("uid", id)
        .maybeSingle();
      if (story) {
        payload.story_slug = (story as { slug?: string }).slug || null;
        payload.story_title = (story as { title?: string }).title || null;
        payload.story_cover = (story as { cover?: string }).cover || null;
      }
    }

    const { error } = await supabase.from("posts").insert(payload);
    if (error) {
      // A missing `posts` column/permission is a configuration state — the
      // chat message may still have gone out; never fail the publish.
      console.warn("[publish-broadcast] feed post skipped:", error.message);
    }
  } catch (e) {
    console.warn("[publish-broadcast] feed post failed:", (e as Error)?.message);
  }
}

/**
 * Fire both publish broadcasts together: global chat message + community
 * feed post. Awaited by callers for observability, but it never throws.
 */
export async function broadcastPublish(input: BroadcastInput): Promise<void> {
  const id = (input.id || "").trim();
  if (!id) return;
  const title = input.title || "";

  try {
    const chat =
      input.kind === "story"
        ? announceStoryPublished(id, title)
        : input.kind === "video"
          ? announceVideoPublished(id, title)
          : announcePicturePublished(id, title);

    const feed = resolvePublishHref(input.kind, id).then((href) =>
      createFeedPost(input.kind, id, title, href, input.actorId),
    );

    await Promise.all([chat, feed]);
  } catch (e) {
    console.warn("[publish-broadcast] broadcast failed:", (e as Error)?.message);
  }
}
