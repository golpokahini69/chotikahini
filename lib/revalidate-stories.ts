import { revalidatePath } from "next/cache";

/**
 * Cache invalidation for the story lifecycle (publish / edit / unpublish /
 * delete), shared by the admin manage API and the author submit API so both
 * paths purge exactly the same set of routes.
 *
 * ── How Next 16 builds the tags we have to hit ─────────────────────────
 *
 * A cached route entry carries the implicit tags derived from its **app-dir
 * path, route groups included**, plus the concrete URL path:
 *
 *   app/(bn)/page.tsx            → `_N_T_/(bn)/page`, `_N_T_/`, `_N_T_/index`
 *   app/(bn)/posts/page.tsx      → `_N_T_/(bn)/posts/page`, `_N_T_/posts`
 *   app/(bn)/[slug]/page.tsx     → `_N_T_/(bn)/[slug]/page`, `_N_T_/<url>`
 *
 * `revalidatePath(path, type)` builds `` `_N_T_` + path (+ "/" + type) `` — it
 * does NOT know about route groups. So the previous
 * `revalidatePath("/", "page")` produced `_N_T_/page`, which matches nothing on
 * the homepage: the listing was never purged on publish and only refreshed when
 * its own `revalidate` window (1 hour for `/`) elapsed. The same mismatch
 * affected every other listing called with the URL + `"page"` form.
 *
 * Therefore, per route:
 *   • static: call BOTH the plain URL (matches the concrete-path tag) and the
 *     app path with `type: "page"` (matches the derived tag);
 *   • dynamic: only the app path with `type: "page"` works — the concrete-path
 *     tag of `/categories/x` is `_N_T_/categories/x`, but the shared tag every
 *     instance of the route carries is `_N_T_/(bn)/categories/[category]/page`.
 *
 * Verified against the build's own `x-next-cache-tags` headers in
 * `.next-build/server/app/*.meta`.
 */
export function revalidateStoryListingPaths() {
  // ── Vercel ISR-write budget ────────────────────────────────────────────
  // Every purged entry is an ISR WRITE the next time that page is hit.
  // Hobby caps writes at 200K/30 days, and the previous version purged the
  // route PATTERNS for page/[num], categories/[category], tags/[tag],
  // archive/[year]/[month] and authors/[id] on EVERY publish. One pattern
  // purge expires EVERY cached instance of that route — hundreds of pages
  // for a single story going live.
  //
  // What still gets purged on publish: the surfaces that must show a new
  // story immediately (homepage + the main posts listing), the story's own
  // URLs, and the feeds. The long-tail listings (category/tag/author/
  // archive/pagination) now refresh on their own timer (6h) and via the
  // category/tag pages' own on-demand paths when those are the ones being
  // edited. That is the deliberate trade: a brand-new story appears on the
  // homepage at once, and in a tag listing at worst a few hours later.

  // Homepage — plain URL + app path (both tag shapes; see the doc above).
  revalidatePath("/");
  revalidatePath("/(bn)", "page");

  // Main listing.
  revalidatePath("/posts");
  revalidatePath("/(bn)/posts", "page");

  // Feeds + sitemap: crawler-facing, low volume, must stay current.
  revalidatePath("/rss.xml");
  revalidatePath("/rss-pictures.xml");
  revalidatePath("/sitemap.xml");
}

/** Invalidate every cached route whose contents depend on one story. */
export function revalidateStoryPaths(
  slug?: string | null,
  uid?: string | null,
  publicSlug?: string | null,
) {
  revalidateStoryListingPaths();
  // Concrete story URLs: `/{uid}` or `/{slug}` (legacy routes) and the
  // canonical `/{publicSlug}` route. Each matches that story's own
  // concrete-path tag, so only the changed story is purged.
  if (slug) revalidatePath(`/${slug}`);
  if (uid && uid !== slug) revalidatePath(`/${uid}`);
  if (publicSlug) revalidatePath(`/golpo/${publicSlug}`);
}
