import { getSupabaseAdmin } from "@/lib/supabase";
import { VIDEOS_PER_PAGE } from "@/lib/constants";
import { resolveEmbed } from "@/lib/embed-resolver";
import { findIdByPublicSlug } from "@/lib/public-slug-store";
import { CACHE_TAGS, cachedRead } from "@/lib/cache";

/**
 * Shared video listing primitive — used by `/videos` and the paginated
 * `/videos/page/[num]`. Returns the slice plus total count so the caller
 * can build pagination.
 *
 * Filters to *published* rows and to videos whose publish time has
 * arrived (lets admins schedule a future publish). Defaults to newest-
 * first so the first page is the freshest.
 */

export interface VideoListRow {
  id: string;
  /**
   * The readable, type-prefixed public slug — e.g.
   * "jamal-nur-video-a3f9c21e-4b1c-…". Null for videos published before
   * public slugs existed; those keep their old /videos/<uuid> URL.
   */
  public_slug: string | null;
  title: string;
  description: string | null;
  source_url: string;
  embed_url: string;
  thumbnail_url: string | null;
  uploader_name: string | null;
  published_at: string;
  view_count?: number | null;
}

export interface VideoPage {
  videos: VideoListRow[];
  total: number;
  pageSize: number;
  page: number;
  totalPages: number;
}

/**
 * Columns we select.
 *
 * Two of them are optional, because they only exist after a migration has
 * been run, and the section has to keep working on a database that hasn't
 * been migrated yet:
 *
 *   - `view_count`  → scripts/video-views.sql
 *   - `public_slug` → scripts/media-slugs.sql
 *
 * The query falls back through the column sets in order, dropping whichever
 * one PostgREST reports as unknown.
 */
const BASE_COLUMNS =
  "id, title, description, source_url, embed_url, thumbnail_url, uploader_name, published_at";

const BASE_COLUMNS_WITH_SLUG = `${BASE_COLUMNS}, public_slug`;

const BASE_COLUMNS_WITH_SLUG_AND_VIEWS = `${BASE_COLUMNS_WITH_SLUG}, view_count`;

const listPublishedVideosCached = cachedRead(
  "published-videos",
  async (safePage: number, safeSize: number): Promise<VideoPage> => {
    const supabase = getSupabaseAdmin();
    const nowIso = new Date().toISOString();
    const offset = (safePage - 1) * safeSize;
    const upper = offset + safeSize;

    let videos: VideoListRow[] | null = null;
    let total = 0;

    const buildQuery = (columns: string) =>
      supabase
        .from("video_posts")
        .select(columns, { count: "exact" })
        .eq("status", "published")
        .not("embed_url", "is", null)
        .lte("published_at", nowIso)
        .order("published_at", { ascending: false })
        .range(offset, upper - 1);

    const columnSets = [
      BASE_COLUMNS_WITH_SLUG_AND_VIEWS,
      BASE_COLUMNS_WITH_SLUG,
      BASE_COLUMNS,
    ];

    let result = await buildQuery(columnSets[0]);

    for (let i = 1; i < columnSets.length && result.error; i++) {
      const message = result.error.message ?? "";
      if (
        result.error.code !== "42703" &&
        result.error.code !== "PGRST204" &&
        !/column .* does not exist|could not find the .* in the schema cache/i.test(
          message,
        )
      ) {
        break;
      }
      result = await buildQuery(columnSets[i]);
    }

    if (!result.error) {
      videos = (result.data as unknown as VideoListRow[]) || null;
      total = result.count ?? 0;
    }

    const rows = videos ?? [];
    const totalPages = Math.max(1, Math.ceil(total / safeSize));

    return {
      videos: rows,
      total,
      pageSize: safeSize,
      page: safePage,
      totalPages,
    };
  },
  {
    revalidate: 86400,
    tags: [CACHE_TAGS.videos],
    keyParts: ([safePage, safeSize]) => [safePage, safeSize],
  }
);

export async function listPublishedVideos({
  page = 1,
  pageSize = VIDEOS_PER_PAGE,
}: { page?: number; pageSize?: number } = {}): Promise<VideoPage> {
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.max(1, Math.floor(pageSize));
  return listPublishedVideosCached(safePage, safeSize);
}

/** A published video, as the detail pages need it. */
export interface PublishedVideo {
  id: string;
  /**
   * The readable public slug, e.g. "jamal-nur-video". Null for videos
   * published before public slugs existed — those keep their old
   * /videos/<uuid> URL.
   */
  public_slug: string | null;
  title: string;
  description: string | null;
  source_url: string;
  embed_url: string;
  thumbnail_url: string | null;
  uploader_name: string | null;
  published_at: string | null;
  updated_at: string | null;
  view_count?: number | null;
}

const DETAIL_COLUMNS =
  "id, title, description, source_url, embed_url, thumbnail_url, uploader_name, published_at, updated_at";

const DETAIL_COLUMNS_WITH_SLUG = `${DETAIL_COLUMNS}, public_slug`;

/**
 * Did PostgREST fail because a selected column doesn't exist?
 *
 * PostgREST reports this as `42703` ("column does not exist") or as a
 * `PGRST204` with a "Could not find the 'column' in the schema cache"
 * message. Both mean the migration hasn't been run yet.
 */
function isMissingColumn(error: { code?: string; message?: string }): boolean {
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /column .* does not exist|could not find the .* in the schema cache/i.test(
    error.message ?? "",
  );
}

/**
 * Fetch one published video by id.
 *
 * Returns null for a missing row, a non-published row, or a video whose
 * publish time hasn't arrived yet — so a draft can never leak through a
 * direct URL hit.
 */
const getPublishedVideoCached = cachedRead(
  "published-video-detail",
  async (videoId: string): Promise<PublishedVideo | null> => {
    const supabase = getSupabaseAdmin();
    const buildQuery = (columns: string) =>
      supabase
        .from("video_posts")
        .select(columns)
        .eq("id", videoId)
        .eq("status", "published")
        .not("embed_url", "is", null)
        .lte("published_at", new Date().toISOString())
        .maybeSingle();

    let result = await buildQuery(DETAIL_COLUMNS_WITH_SLUG);

    if (result.error && isMissingColumn(result.error)) {
      result = await buildQuery(DETAIL_COLUMNS);
    }

    if (result.error) {
      console.error("[videos] detail query failed:", result.error);
      return null;
    }

    const video = (result.data as PublishedVideo | null) || null;
    if (!video) return null;

    const embedUrl = resolveEmbed(video.embed_url)?.embedUrl ?? video.embed_url;

    return {
      ...video,
      public_slug: video.public_slug ?? null,
      embed_url: embedUrl,
    };
  },
  {
    revalidate: 86400,
    tags: [CACHE_TAGS.videos],
    keyParts: ([videoId]) => [videoId],
  }
);

export async function getPublishedVideo(
  videoId: string,
): Promise<PublishedVideo | null> {
  if (!videoId) return null;
  return getPublishedVideoCached(videoId);
}

const getPublishedVideoBySlugCached = cachedRead(
  "published-video-slug",
  async (publicSlug: string): Promise<PublishedVideo | null> => {
    const videoId = await findIdByPublicSlug("video", publicSlug);
    if (!videoId) return null;
    return getPublishedVideo(videoId);
  },
  {
    revalidate: 86400,
    tags: [CACHE_TAGS.videos],
    keyParts: ([publicSlug]) => [publicSlug],
  }
);

export async function getPublishedVideoBySlug(
  publicSlug: string,
): Promise<PublishedVideo | null> {
  if (!publicSlug) return null;
  return getPublishedVideoBySlugCached(publicSlug);
}
