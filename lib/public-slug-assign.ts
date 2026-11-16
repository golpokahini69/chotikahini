/**
 * lib/public-slug-assign.ts
 *
 * The one place that decides what an item's public slug is.
 *
 * The rule, in one line: a slug is minted the first time an item becomes
 * public, and it never changes afterwards. That means:
 *
 *   - A story published today gets its slug when it is published — not
 *     when it is drafted, because the title may still be edited before
 *     it goes live.
 *   - Renaming a published item does NOT change its URL. A link that was
 *     shared keeps working, which is the whole point.
 *
 * Everything here is best-effort: a slug failure must never stop a story
 * from being published. If the slug can't be generated, the item simply
 * keeps its old-style URL (`/{uid}`, `/videos/<uuid>`), which still works.
 */

import { buildPublicSlug, type PublicSlugKind } from "@/lib/public-slug";
import { isPublicSlugTaken } from "@/lib/public-slug-store";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Generate a slug for an item WITHOUT writing it anywhere.
 *
 * Use this when the row is about to be inserted (or inserted with the slug
 * included in the payload) — the "is this slug taken?" check only needs to
 * look at the rows that already exist.
 *
 * Returns null when no slug could be produced.
 */
export async function mintPublicSlug(
  kind: PublicSlugKind,
  title: string,
  excludeId?: string | null,
): Promise<string | null> {
  try {
    return await buildPublicSlug(title, kind, (candidate) =>
      isPublicSlugTaken(kind, candidate, excludeId),
    );
  } catch (err) {
    console.error(`[public-slug] could not build slug:`, err);
    return null;
  }
}

/**
 * Generate a slug for an item and write it to its row.
 *
 * Returns the slug that was written, or null when none could be produced
 * (the row is then left without a public slug and keeps its old URL).
 *
 * `excludeId` lets a caller re-slug an existing row without the row's own
 * current slug counting as a collision.
 */
export async function assignPublicSlug(
  kind: PublicSlugKind,
  table: "stories" | "video_posts" | "picture_galleries",
  idColumn: "uid" | "id",
  rowId: string,
  title: string,
  excludeId?: string | null,
): Promise<string | null> {
  try {
    const slug = await buildPublicSlug(title, kind, (candidate) =>
      isPublicSlugTaken(kind, candidate, excludeId),
    );

    if (!slug) return null;

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from(table)
      .update({ public_slug: slug })
      .eq(idColumn, rowId);

    if (error) {
      console.error(`[public-slug] failed to save slug for ${table}/${rowId}:`, error);
      return null;
    }

    return slug;
  } catch (err) {
    // Never let a slug problem stop a publish.
    console.error(`[public-slug] could not build slug for ${table}/${rowId}:`, err);
    return null;
  }
}
