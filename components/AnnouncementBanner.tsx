import { getAnnouncement } from "@/lib/announcement";
import { AnnouncementBannerClient } from "./AnnouncementBannerClient";

/**
 * Site-wide announcement banner.
 *
 * Server-rendered from the tagged cache in `lib/announcement.ts`, so the
 * banner is in the first HTML payload and no `/api/admin/announcement`
 * request is made by the browser. Admin edits invalidate the cache tag.
 *
 * The fetch is guarded, but the JSX is returned OUTSIDE the try/catch: React
 * renders lazily, so an error thrown while rendering this element would not
 * be caught by a surrounding try/catch anyway (and building JSX inside one
 * is flagged as a bug by the linter). Fetch first, then render.
 */
export async function AnnouncementBanner() {
  let announcement = null;
  try {
    announcement = await getAnnouncement();
  } catch {
    return null;
  }

  return <AnnouncementBannerClient announcement={announcement} />;
}
