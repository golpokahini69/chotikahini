import { revalidatePath } from "next/cache";

/**
 * Cache invalidation for the media (videos / pictures) write paths: admin
 * create/edit/delete plus the scheduled-publish cron.
 *
 * The homepage renders `HomeVideoHero` / `HomeVideoRail` / `HomePictureStrip`
 * from these same lists, so a media write must purge `/` as well as the media
 * listings. Data tags alone (`invalidateTags(CACHE_TAGS.videos)`) are NOT
 * enough: a page entry only carries a data tag while its render actually read
 * that cached value, and Next 16 stops collecting those tags for runtime
 * (`request`) renders — so after the first purge-and-re-render the entry has
 * only its implicit path tags left. `revalidatePath()` targets those implicit
 * tags, which are always present.
 *
 * Same route-group caveat as lib/revalidate-stories.ts: the implicit tags are
 * derived from the app path INCLUDING route groups (`app/(bn)/…`), so dynamic
 * routes must be revalidated as the app path + `type: "page"`.
 */
export function revalidateVideoPaths() {
  // Homepage (video hero/rail/strip) — URL form + app-path form.
  revalidatePath("/");
  revalidatePath("/(bn)", "page");

  // /videos listings.
  revalidatePath("/videos");
  revalidatePath("/(bn)/videos", "page");
  revalidatePath("/(bn)/videos/page/[num]", "page");

  // /videos/<id> detail pages (all instances of the route).
  revalidatePath("/(bn)/videos/[videoId]", "page");
}

export function revalidatePicturePaths() {
  // Homepage picture strip.
  revalidatePath("/");
  revalidatePath("/(bn)", "page");

  // /pictures listings, pagination and detail pages.
  revalidatePath("/pictures");
  revalidatePath("/(bn)/pictures", "page");
  revalidatePath("/(bn)/pictures/page/[num]", "page");
  revalidatePath("/(bn)/pictures/[galleryId]", "page");

  // Category / tag filtered listings.
  revalidatePath("/(bn)/pictures/tags", "page");
  revalidatePath("/(bn)/pictures/category/[category]", "page");
  revalidatePath("/(bn)/pictures/category/[category]/page/[num]", "page");
  revalidatePath("/(bn)/pictures/tag/[tag]", "page");
  revalidatePath("/(bn)/pictures/tag/[tag]/page/[num]", "page");

  revalidatePath("/rss-pictures.xml");
}
