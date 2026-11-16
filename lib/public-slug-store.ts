/**
 * lib/public-slug-store.ts
 *
 * The database half of the public-slug system.
 *
 * `lib/public-slug.ts` knows how to turn a title into a slug and how to
 * disambiguate duplicates with a `-1`, `-2` suffix. It can't tell whether
 * a candidate slug is already in use — that's a database question, and
 * the three content types live in three different tables.
 *
 * This module supplies that missing half: one "is this slug taken?" query
 * per content type, plus the reverse lookup the public routes need.
 *
 * Note the scope of the uniqueness check: a slug only has to be unique
 * WITHIN its content type. A story, a video and an image can all be
 * "dhaka-new-bridge" at the same time, because they live under different
 * URL prefixes (/golpo/, /video/, /image/).
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import type { PublicSlugKind } from "@/lib/public-slug";

/** The table each content type stores its slug in. */
const TABLE_FOR_KIND: Record<PublicSlugKind, string> = {
  story: "stories",
  video: "video_posts",
  picture: "picture_galleries",
};

/**
 * Is this slug already used by a row of the given kind?
 *
 * `excludeId` lets a caller ask "would this slug be free if I were this
 * row?" — which is what an edit needs, so that renaming a title to
 * something that already collides doesn't report the item's OWN slug as
 * taken.
 */
export async function isPublicSlugTaken(
  kind: PublicSlugKind,
  candidate: string,
  excludeId?: string | null,
): Promise<boolean> {
  if (!candidate) return false;

  const table = TABLE_FOR_KIND[kind];
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from(table)
    .select("id")
    .eq("public_slug", candidate)
    .limit(1);

  if (excludeId) {
    // The three tables use different id columns: `stories` has both `id`
    // (uuid) and `uid` (14-digit), while the media tables only have `id`.
    if (kind === "story") {
      query = query.neq("uid", excludeId);
    } else {
      query = query.neq("id", excludeId);
    }
  }

  const { data, error } = await query;

  if (error) {
    // The `public_slug` column doesn't exist yet (scripts/media-slugs.sql
    // hasn't been run). Nothing is taken, so the caller gets a free slug.
    console.warn(
      `[public-slug] could not check "${candidate}" — public_slug column missing?`,
      error.message,
    );
    return false;
  }

  return Array.isArray(data) && data.length > 0;
}

/**
 * Find a row of the given kind by its public slug.
 *
 * Returns the id of the matching row, or null. Stories are matched on
 * `uid` (the 14-digit id used in URLs), media on the uuid `id`.
 */
export async function findIdByPublicSlug(
  kind: PublicSlugKind,
  publicSlug: string,
): Promise<string | null> {
  if (!publicSlug) return null;

  const table = TABLE_FOR_KIND[kind];
  const supabase = getSupabaseAdmin();
  const idColumn = kind === "story" ? "uid" : "id";

  const { data, error } = await supabase
    .from(table)
    .select(idColumn)
    .eq("public_slug", publicSlug)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(
      `[public-slug] could not look up "${publicSlug}" — public_slug column missing?`,
      error.message,
    );
    return null;
  }

  const row = data as Record<string, string> | null;
  return row?.[idColumn] ?? null;
}
