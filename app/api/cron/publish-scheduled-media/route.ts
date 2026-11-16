import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  announcePicturePublished,
  announceStoryPublished,
  announceVideoPublished,
} from "@/lib/chat-system";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { clearPostsCache } from "@/lib/posts";
import { CACHE_TAGS, invalidateTags } from "@/lib/cache";

export const dynamic = "force-dynamic";

/**
 * Publishes the content whose scheduled time has arrived.
 *
 * A scheduled row is written with `status = 'published'` and a FUTURE
 * `published_at`, so every public read path (which filters on
 * `published_at <= now()`) already hides it until its moment comes. This
 * route exists for the two things the read-path filter cannot do:
 *
 *   1. clear `scheduled_at`, so the admin list stops calling it
 *      "scheduled" and shows it as a live post
 *   2. fire the chat announcement at the moment the post goes live
 *
 * Covers videos, picture galleries, and stories.
 *
 * It is safe to run as often as you like — the query only picks up rows
 * whose schedule has already passed, and each row is processed once
 * (the `scheduled_at IS NOT NULL` guard means a second run finds
 * nothing left to do).
 *
 * ── Authentication ───────────────────────────────────────────────────────
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically
 * when `CRON_SECRET` is set in the project environment. When that env var
 * is absent (local development), the route falls back to requiring an
 * admin session so it can't be triggered by an anonymous visitor.
 */

/** Rows due for publication, per table. */
interface DueRow {
  id: string;
  title: string;
  scheduled_at: string;
  published_at: string | null;
}

async function authorizeCron(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;

  if (secret) {
    const header = request.headers.get("authorization") || "";
    const expected = `Bearer ${secret}`;
    // Constant-time-ish comparison — the length check first keeps the
    // early-exit cheap without leaking anything meaningful.
    if (header.length !== expected.length) return false;
    let mismatch = 0;
    for (let i = 0; i < header.length; i++) {
      mismatch |= header.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return mismatch === 0;
  }

  // No secret configured — fall back to an admin session so the endpoint
  // stays closed to the public.
  const session = await getSession();
  return !!session && hasPermission(session.role, "media.upload");
}

/**
 * Move every row whose schedule has passed into its published state.
 *
 * `published_at` is pinned to the ORIGINAL scheduled time rather than
 * "now", so the post keeps the publish date the admin chose instead of
 * drifting by however long the cron happened to be late.
 */
async function publishDueRows(
  table: "video_posts" | "picture_galleries",
): Promise<{ published: number; titles: { id: string; title: string }[] }> {
  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from(table)
    .select("id, title, scheduled_at, published_at")
    .eq("status", "published")
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", nowIso)
    .limit(200);

  if (error) {
    // A missing `scheduled_at` column (migration not run yet) is a
    // configuration state, not a crash — log it and move on.
    console.warn(`[cron/publish-scheduled-media] ${table} query failed:`, error.message);
    return { published: 0, titles: [] };
  }

  const rows = (data as unknown as DueRow[]) || [];
  if (rows.length === 0) return { published: 0, titles: [] };

  const titles: { id: string; title: string }[] = [];
  let published = 0;

  for (const row of rows) {
    // Keep the admin's chosen publish time; just drop the "scheduled"
    // marker so the row reads as a live post from now on.
    const { error: updateError } = await supabase
      .from(table)
      .update({
        published_at: row.scheduled_at || row.published_at || nowIso,
        scheduled_at: null,
        updated_at: nowIso,
      })
      .eq("id", row.id)
      .not("scheduled_at", "is", null);

    if (updateError) {
      console.error(
        `[cron/publish-scheduled-media] ${table} update failed for ${row.id}:`,
        updateError.message,
      );
      continue;
    }

    published++;
    titles.push({ id: row.id, title: row.title });
  }

  return { published, titles };
}

/**
 * Move every scheduled STORY whose time has passed into its live state.
 *
 * Stories differ from the media tables in two ways: they are keyed by `uid`
 * (not `id`), and they carry a `history` blob that records the publish
 * event. The `scheduled_at IS NOT NULL` guard keeps this idempotent — a
 * second cron run finds nothing left to do.
 */
async function publishDueStories(): Promise<{
  published: number;
  titles: { id: string; title: string }[];
}> {
  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("stories")
    .select("uid, title, scheduled_at, published_at, history")
    .eq("status", "published")
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", nowIso)
    .limit(200);

  if (error) {
    // A missing `scheduled_at` column (migration not run yet) is a
    // configuration state, not a crash — log it and move on.
    console.warn(`[cron/publish-scheduled-media] stories query failed:`, error.message);
    return { published: 0, titles: [] };
  }

  const rows = (data as unknown as (DueRow & { uid: string; history?: any })[]) || [];
  if (rows.length === 0) return { published: 0, titles: [] };

  const titles: { id: string; title: string }[] = [];
  let published = 0;

  for (const row of rows) {
    const history = Array.isArray(row.history) ? [...row.history] : [];
    history.push({ event: "published", at: nowIso, actor: "cron" });

    const { error: updateError } = await supabase
      .from("stories")
      .update({
        published_at: row.scheduled_at || row.published_at || nowIso,
        scheduled_at: null,
        updated_at: nowIso,
        history,
      })
      .eq("uid", row.uid)
      .not("scheduled_at", "is", null);

    if (updateError) {
      console.error(
        `[cron/publish-scheduled-media] stories update failed for ${row.uid}:`,
        updateError.message,
      );
      continue;
    }

    published++;
    titles.push({ id: row.uid, title: row.title });
  }

  return { published, titles };
}

export async function GET(request: Request) {
  if (!(await authorizeCron(request))) {
    return NextResponse.json({ error: "অননুমোদিত অ্যাক্সেস।" }, { status: 401 });
  }

  try {
    const [videos, pictures, stories] = await Promise.all([
      publishDueRows("video_posts"),
      publishDueRows("picture_galleries"),
      publishDueStories(),
    ]);

    // Every content type gets a chat announcement the moment it goes live.
    for (const video of videos.titles) {
      await announceVideoPublished(video.id, video.title);
    }
    for (const picture of pictures.titles) {
      await announcePicturePublished(picture.id, picture.title);
    }
    for (const story of stories.titles) {
      await announceStoryPublished(story.id, story.title);
    }

    if (videos.published > 0) invalidateTags(CACHE_TAGS.videos);
    if (pictures.published > 0) invalidateTags(CACHE_TAGS.pictures);
    if (stories.published > 0) clearPostsCache();

    return NextResponse.json({
      success: true,
      publishedVideos: videos.published,
      publishedPictures: pictures.published,
      publishedStories: stories.published,
      videos: videos.titles,
      pictures: pictures.titles,
      stories: stories.titles,
    });
  } catch (error) {
    console.error("[cron/publish-scheduled-media] failed:", error);
    return NextResponse.json(
      { error: "শিডিউলড পোস্ট প্রকাশ করা যায়নি।" },
      { status: 500 },
    );
  }
}
