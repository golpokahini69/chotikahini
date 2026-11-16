import Link from "next/link";
import { listPublishedPictures } from "@/lib/pictures";
import { toCardData } from "@/components/PictureListShell";
import { enToBnNumber } from "@/lib/utils";
import { isPictureSectionEnabled } from "@/lib/config";
import { PictureScrollRail } from "@/components/PictureScrollRail";

/**
 * HomePictureStrip — the homepage's picture module.
 *
 * Design rule: the homepage is a *teaser*, not a second library page.
 *
 * Picture covers are portrait (3:4), so the obvious "copy the video strip"
 * layout — two half-width headline cards plus a grid below — blows the
 * homepage open: the headline pair alone is ~730px tall on desktop and the
 * grid adds another ~350px. The picture module ended up taller than the
 * video module it was meant to sit beside.
 *
 * Instead the whole module is ONE horizontal rail of small portrait tiles.
 * It is one band tall at every breakpoint, so it reads as a shelf the
 * visitor can swipe or arrow through, and the full gallery lives one click
 * away at /pictures.
 */
export async function HomePictureStrip() {
  // Site-wide kill switch: when the picture section is off the homepage
  // skips the query entirely, so no homepage request touches the table.
  if (!isPictureSectionEnabled()) return null;

  // The homepage is a *teaser* — "সব দেখুন" → /pictures carries the full set.
  //
  // A failed query must NOT take the homepage down with it: the strip is a
  // nice-to-have module, and a missing/broken gallery table is an
  // infrastructure problem, not a reason to 500 the most important page on
  // the site. Swallow the error and simply omit the strip.
  let pictures: Awaited<ReturnType<typeof listPublishedPictures>>["pictures"] = [];
  let total = 0;
  try {
    const result = await listPublishedPictures({ page: 1, pageSize: 20 });
    pictures = result.pictures;
    total = result.total;
  } catch (err) {
    console.error("[HomePictureStrip] failed to load galleries:", err);
    return null;
  }
  if (pictures.length === 0) return null;

  const cards = pictures.map(toCardData);
  const shown = total > cards.length ? cards.length : total;

  return (
    <section className="mb-8" aria-label="ছবি">
      <StripHeader shown={shown} total={total} />

      {/* One row of portrait tiles — swipe on touch, arrows on desktop. */}
      <PictureScrollRail
        pictures={cards}
        sizes="(max-width: 640px) 42vw, (max-width: 1024px) 30vw, (max-width: 1280px) 16vw, 13.5vw"
      />
    </section>
  );
}

/** Header + link, matching the video strip's shape. */
function StripHeader({ shown, total }: { shown: number; total?: number }) {
  // When the shelf is capped (homepage shows N of M), say so — otherwise
  // "সদ্য প্রকাশিত ১০টি" reads as "there are only 10 galleries".
  const capped = typeof total === "number" && total > shown;

  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="h-3.5 w-0.5 shrink-0 translate-y-0.5 rounded-full bg-blue-600 dark:bg-blue-400" />
        <h2 className="text-sm font-bold tracking-tight text-fg">ছবি</h2>
        <span className="text-xs text-fg-subtle">
          সদ্য প্রকাশিত {enToBnNumber(shown)}টি
          {capped ? ` / মোট ${enToBnNumber(total)}টি` : ""}
        </span>
      </div>
      <Link
        href="/pictures"
        className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
      >
        সব দেখুন
      </Link>
    </div>
  );
}
