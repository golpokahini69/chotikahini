import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { clearPostsCache } from "@/lib/posts";
import { CACHE_TAGS, invalidateTags } from "@/lib/cache";
import { clearOgCache } from "@/lib/og-cache";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/purge-cache
 *
 * Drops every read cache tier after the database has been changed outside
 * the app (SQL import, manual row edit, restore from a dump):
 *
 *   • L1 in-process micro-cache
 *   • L2 Next.js Data Cache entries, by tag
 *   • OG image cache
 *   • every rendered route, so ISR pages rebuild on the next request
 *
 * Without this a bulk import is invisible for up to 24h, because
 * `lib/cache.ts` holds DB reads for a day and only a mutating API route
 * normally invalidates them.
 */
export async function POST() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "settings.content")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  clearPostsCache();
  invalidateTags(Object.values(CACHE_TAGS));
  clearOgCache();

  for (const path of [
    "/",
    "/posts",
    "/pictures",
    "/videos",
    "/featured",
    "/archive",
    "/categories",
    "/tags",
    "/series",
    "/authors",
    "/rss.xml",
    "/rss-pictures.xml",
    "/atom.xml",
    "/sitemap.xml",
  ]) {
    revalidatePath(path);
  }

  return NextResponse.json({ success: true, purged: Object.values(CACHE_TAGS) });
}
