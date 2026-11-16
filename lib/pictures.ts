import { getSupabaseAdmin } from "@/lib/supabase";
import { PICTURES_PER_PAGE } from "@/lib/constants";
import { findIdByPublicSlug } from "@/lib/public-slug-store";
import { CACHE_TAGS, cachedRead } from "@/lib/cache";

/**
 * Shared picture-listing primitive — used by `/pictures` and the
 * paginated `/pictures/page/[num]`. Returns the slice plus total count so
 * the caller can build pagination.
 *
 * The picture section mirrors the video section: no image file is ever
 * stored or served by us. Each row keeps the provider's CDN URLs and the
 * browser streams the images straight from the provider.
 *
 * Filters to *published* rows and to galleries whose publish time has
 * arrived (lets admins schedule a future publish). Defaults to newest-
 * first so the first page is the freshest.
 */

export interface PictureImage {
  url: string;
  thumb: string;
  width: number | null;
  height: number | null;
}

export interface PictureListRow {
  id: string;
  /**
   * The readable, type-prefixed public slug — e.g.
   * "kutir-chobi-b71d4e88-9a02-…". Null for galleries published before
   * public slugs existed; those keep their old /pictures/<uuid> URL.
   */
  public_slug: string | null;
  title: string;
  description: string | null;
  source_url: string;
  cover_url: string;
  images: PictureImage[];
  image_count: number;
  model_name: string | null;
  channel_name: string | null;
  categories: string[] | null;
  tags: string[] | null;
  /**
   * The PROVIDER's own view counter, scraped from the source page.
   * This is not our site's traffic — it is the number the other site
   * published for this gallery.
   */
  source_views: number | null;
  /**
   * OUR site's view counter — how many unique viewers opened this gallery
   * on this site. Bumped by /api/pictures/[id]/view.
   */
  view_count: number | null;
  published_at: string;
  /**
   * When the row was last changed.
   *
   * Used to fingerprint the gallery's share card, so that editing a
   * title or swapping the cover produces a new card instead of the
   * previously-cached bytes.
   */
  updated_at: string | null;
}

export interface PicturePage {
  pictures: PictureListRow[];
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
 *   - `view_count`  → scripts/picture-views.sql
 *   - `public_slug` → scripts/media-slugs.sql
 *
 * Each is dropped independently: the query retries without the missing one
 * rather than giving up on the whole column set.
 */
const BASE_COLUMNS =
  "id, title, description, source_url, cover_url, image_count, model_name, channel_name, categories, tags, source_views, published_at, updated_at";

const BASE_COLUMNS_WITH_SLUG = `${BASE_COLUMNS}, public_slug`;

const BASE_COLUMNS_WITH_SLUG_AND_VIEWS = `${BASE_COLUMNS_WITH_SLUG}, view_count`;

const DETAIL_COLUMNS = `${BASE_COLUMNS}, images`;
const DETAIL_COLUMNS_WITH_SLUG = `${BASE_COLUMNS_WITH_SLUG}, images`;
const DETAIL_COLUMNS_WITH_SLUG_AND_VIEWS = `${BASE_COLUMNS_WITH_SLUG_AND_VIEWS}, images`;

/**
 * Canonical uuid shape. `picture_galleries.id` is a `uuid` column, so any
 * other string is a malformed request rather than a missing row.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Did PostgREST fail because a selected column doesn't exist?
 *
 * PostgREST reports this as `42703` ("column does not exist") or as a
 * `PGRST204` with a "Could not find the 'column' in the schema cache"
 * message. Both mean the same thing: the migration hasn't been run yet.
 */
function isMissingColumn(error: { code?: string; message?: string }): boolean {
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /column .* does not exist|could not find the .* in the schema cache/i.test(
    error.message ?? "",
  );
}

/**
 * Run a query, dropping optional columns PostgREST doesn't know about.
 *
 * `columnSets` is tried in order — richest first. If a query fails because
 * one of its selected columns doesn't exist yet, the next (leaner) set is
 * tried instead. This is what lets the picture section keep working on a
 * database where only some of the optional migrations have been run.
 *
 * The response type is carried through from the caller's query builder, so
 * PostgREST extras like `count` survive the retry.
 */
async function queryWithOptionalColumns<TResponse extends { error: any }>(
  buildQuery: (columns: string) => PromiseLike<TResponse>,
  columnSets: string[],
): Promise<TResponse> {
  let result = await buildQuery(columnSets[0]);

  for (
    let i = 1;
    i < columnSets.length &&
    result.error &&
    isMissingColumn(result.error);
    i++
  ) {
    console.warn(
      "[pictures] optional column missing — run scripts/picture-views.sql and scripts/media-slugs.sql",
    );
    result = await buildQuery(columnSets[i]);
  }

  return result;
}

/**
 * Normalise the `images` JSONB column into a typed array.
 *
 * The column is free-form JSONB, so a hand-edited row could hold anything —
 * we drop any entry that isn't a usable https image URL rather than letting
 * a broken <img> reach the page.
 */
export function normalizeImages(raw: unknown): PictureImage[] {
  if (!Array.isArray(raw)) return [];

  const out: PictureImage[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const url = typeof item.url === "string" ? item.url : "";
    const thumb = typeof item.thumb === "string" ? item.thumb : "";
    if (!url.startsWith("https://")) continue;

    const width = Number(item.width);
    const height = Number(item.height);
    out.push({
      url,
      thumb: thumb.startsWith("https://") ? thumb : url,
      width: Number.isFinite(width) && width > 0 ? width : null,
      height: Number.isFinite(height) && height > 0 ? height : null,
    });
  }
  return out;
}

const getPublishedPicturesCached = cachedRead(
  "published-pictures",
  async (
    safePage: number,
    safeSize: number,
    tag: string | null,
    category: string | null
  ): Promise<PicturePage> => {
    const supabase = getSupabaseAdmin();
    const nowIso = new Date().toISOString();
    const offset = (safePage - 1) * safeSize;
    const upper = offset + safeSize;

    const buildQuery = (columns: string) => {
      let query = supabase
        .from("picture_galleries")
        .select(columns, { count: "exact" })
        .eq("status", "published")
        .not("cover_url", "is", null)
        .lte("published_at", nowIso)
        .order("published_at", { ascending: false });

      if (tag) query = query.contains("tags", [tag]);
      if (category) query = query.contains("categories", [category]);

      return query.range(offset, upper - 1);
    };

    const paged = await queryWithOptionalColumns(buildQuery, [
      BASE_COLUMNS_WITH_SLUG_AND_VIEWS,
      BASE_COLUMNS_WITH_SLUG,
      BASE_COLUMNS,
    ]);

    if (paged.error && (tag || category)) {
      const viaRpc = await listByFilterRpc({
        tag,
        category,
        page: safePage,
        pageSize: safeSize,
      });
      if (viaRpc) return viaRpc;
    }

    if (paged.error) {
      if (paged.error.code === "PGRST103") {
        return {
          pictures: [],
          total: 0,
          pageSize: safeSize,
          page: safePage,
          totalPages: 1,
        };
      }
      console.error("[pictures] list failed:", paged.error);
      throw paged.error;
    }

    const rows = (paged.data as unknown as PictureListRow[]) || [];
    const total = paged.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / safeSize));

    return {
      pictures: rows.map((row) => ({ ...row, images: normalizeImages(row.images) })),
      total,
      pageSize: safeSize,
      page: safePage,
      totalPages,
    };
  },
  {
    revalidate: 86400,
    tags: [CACHE_TAGS.pictures],
    keyParts: ([safePage, safeSize, tag, category]) => [
      safePage,
      safeSize,
      tag || "",
      category || "",
    ],
    ttlMs: 600_000,
    staleMs: 300_000,
  }
);

export async function listPublishedPictures({
  page = 1,
  pageSize = PICTURES_PER_PAGE,
  tag = null,
  category = null,
}: {
  page?: number;
  pageSize?: number;
  tag?: string | null;
  category?: string | null;
} = {}): Promise<PicturePage> {
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.max(1, Math.floor(pageSize));
  return getPublishedPicturesCached(safePage, safeSize, tag, category);
}

/**
 * Fetch a filtered page through the case-insensitive RPCs.
 *
 * The RPCs in scripts/picture-tags.sql do the array containment check
 * with `lower(...) @> array[lower(...)]`, which matches "Blonde" against
 * a gallery tagged "blonde". PostgREST's own `cs` operator is
 * case-sensitive, so the RPC is the preferred path whenever a tag or
 * category filter is active.
 *
 * Returns null when the RPC isn't deployed, so the caller can fall back
 * to the case-sensitive PostgREST query rather than showing an empty
 * page.
 */
async function listByFilterRpc({
  tag,
  category,
  page,
  pageSize,
}: {
  tag: string | null;
  category: string | null;
  page: number;
  pageSize: number;
}): Promise<PicturePage | null> {
  const supabase = getSupabaseAdmin();

  const fn = tag ? "list_pictures_by_tag" : "list_pictures_by_category";
  const countFn = tag
    ? "count_pictures_by_tag"
    : "count_pictures_by_category";
  const value = tag ?? category;
  if (!value) return null;

  const rowsResult = await supabase.rpc(fn, {
    p_tag: tag ?? undefined,
    p_category: category ?? undefined,
    p_page: page,
    p_page_size: pageSize,
  });

  // PGRST202 = "function not found" — the RPC hasn't been deployed yet.
  if (rowsResult.error) {
    if (rowsResult.error.code !== "PGRST202" && rowsResult.error.code !== "42883") {
      console.error("[pictures] filter RPC failed:", rowsResult.error);
    }
    return null;
  }

  const countResult = await supabase.rpc(countFn, {
    p_tag: tag ?? undefined,
    p_category: category ?? undefined,
  });

  const rows = (rowsResult.data as unknown as PictureListRow[]) || [];
  const total = countResult.error
    ? rows.length
    : Number(countResult.data) || 0;

  return {
    pictures: rows.map((row) => ({ ...row, images: normalizeImages(row.images) })),
    total,
    pageSize,
    page,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Every tag used across published galleries, with how many galleries
 * carry it.
 *
 * Prefers the `list_picture_tags` RPC (scripts/picture-tags.sql), which
 * unnests and groups in the database. If that function has not been
 * deployed yet we fall back to pulling the tag arrays and counting them
 * here — the picture library is small, so that fallback is cheap.
 *
 * Only published, live galleries are counted, so a tag shown in the
 * filter bar always leads to a non-empty result.
 */
const listPictureTagsCached = cachedRead(
  "picture-tags",
  async (): Promise<Array<{ tag: string; count: number }>> => {
    const supabase = getSupabaseAdmin();

    const rpc = await supabase.rpc("list_picture_tags");
    if (!rpc.error && Array.isArray(rpc.data)) {
      return (rpc.data as unknown as Array<{ tag: string; count: number }>)
        .map((row) => ({ tag: String(row.tag), count: Number(row.count) || 0 }))
        .filter((row) => row.tag && row.count > 0);
    }

    // The RPC isn't deployed — count the tags in the app instead.
    const result = await supabase
      .from("picture_galleries")
      .select("tags")
      .eq("status", "published")
      .not("cover_url", "is", null)
      .lte("published_at", new Date().toISOString());

    if (result.error) {
      console.error("[pictures] tag list failed:", result.error);
      throw result.error;
    }

    const counts = new Map<string, number>();
    for (const row of (result.data as unknown as PictureListRow[]) || []) {
      const tags = row.tags;
      if (!Array.isArray(tags)) continue;
      for (const tag of tags) {
        const name = typeof tag === "string" ? tag.trim() : "";
        if (!name) continue;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  },
  {
    revalidate: 86400,
    tags: [CACHE_TAGS.pictures],
    ttlMs: 600_000,
    staleMs: 300_000,
  }
);

export async function listPictureTags(): Promise<
  Array<{ tag: string; count: number }>
> {
  return listPictureTagsCached();
}

const listPictureCategoriesCached = cachedRead(
  "picture-categories",
  async (): Promise<Array<{ category: string; count: number }>> => {
    const supabase = getSupabaseAdmin();

    const rpc = await supabase.rpc("list_picture_categories");
    if (!rpc.error && Array.isArray(rpc.data)) {
      return (
        rpc.data as unknown as Array<{ category: string; count: number }>
      )
        .map((row) => ({
          category: String(row.category),
          count: Number(row.count) || 0,
        }))
        .filter((row) => row.category && row.count > 0);
    }

    const result = await supabase
      .from("picture_galleries")
      .select("categories")
      .eq("status", "published")
      .not("cover_url", "is", null)
      .lte("published_at", new Date().toISOString());

    if (result.error) {
      console.error("[pictures] category list failed:", result.error);
      throw result.error;
    }

    const counts = new Map<string, number>();
    for (const row of (result.data as unknown as PictureListRow[]) || []) {
      const categories = row.categories;
      if (!Array.isArray(categories)) continue;
      for (const category of categories) {
        const name = typeof category === "string" ? category.trim() : "";
        if (!name) continue;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  },
  {
    revalidate: 86400,
    tags: [CACHE_TAGS.pictures],
    ttlMs: 600_000,
    staleMs: 300_000,
  }
);

export async function listPictureCategories(): Promise<
  Array<{ category: string; count: number }>
> {
  return listPictureCategoriesCached();
}

/**
 * Fetch one published gallery by id.
 *
 * Returns null for a missing row, a non-published row, or a gallery whose
 * publish time hasn't arrived yet — so a draft can never leak through a
 * direct URL hit.
 *
 * A *query* failure (missing table, network, permissions) is re-thrown
 * rather than folded into the same null. That distinction matters: a null
 * renders a 404, but a swallowed infrastructure error would render a
 * soft-404 (404 content served with a 200 status), which search engines
 * index as duplicate thin pages. Letting the error bubble turns it into a
 * real 500, which is the honest signal.
 */
const getPublishedPictureCached = cachedRead(
  "published-picture-detail",
  async (galleryId: string): Promise<PictureListRow | null> => {
    const supabase = getSupabaseAdmin();
    const buildQuery = (columns: string) =>
      supabase
        .from("picture_galleries")
        .select(columns)
        .eq("id", galleryId)
        .eq("status", "published")
        .not("cover_url", "is", null)
        .lte("published_at", new Date().toISOString())
        .maybeSingle();

    const result = await queryWithOptionalColumns(buildQuery, [
      DETAIL_COLUMNS_WITH_SLUG_AND_VIEWS,
      DETAIL_COLUMNS_WITH_SLUG,
      DETAIL_COLUMNS,
    ]);

    const { data, error } = result;

    if (error) {
      console.error("[pictures] detail query failed:", error);
      throw error;
    }

    const row = (data as unknown as PictureListRow) || null;
    if (!row) return null;
    return { ...row, public_slug: row.public_slug ?? null, images: normalizeImages(row.images) };
  },
  {
    revalidate: 86400,
    tags: [CACHE_TAGS.pictures],
    keyParts: ([galleryId]) => [galleryId],
    ttlMs: 600_000,
    staleMs: 300_000,
  }
);

export async function getPublishedPicture(
  galleryId: string,
): Promise<PictureListRow | null> {
  if (!galleryId || !UUID_PATTERN.test(galleryId)) return null;
  return getPublishedPictureCached(galleryId);
}

const getPublishedPictureBySlugCached = cachedRead(
  "published-picture-slug",
  async (publicSlug: string): Promise<PictureListRow | null> => {
    const galleryId = await findIdByPublicSlug("picture", publicSlug);
    if (!galleryId) return null;
    return getPublishedPicture(galleryId);
  },
  {
    revalidate: 86400,
    tags: [CACHE_TAGS.pictures],
    keyParts: ([publicSlug]) => [publicSlug],
    ttlMs: 600_000,
    staleMs: 300_000,
  }
);

/**
 * Fetch one published gallery by its public slug.
 *
 * The slug is the title in kebab-case, so it has to be matched against the
 * `public_slug` column — there is no id embedded in it to parse out.
 */
export async function getPublishedPictureBySlug(
  publicSlug: string,
): Promise<PictureListRow | null> {
  if (!publicSlug) return null;
  return getPublishedPictureBySlugCached(publicSlug);
}
