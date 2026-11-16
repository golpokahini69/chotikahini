import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Images, X } from "lucide-react";
import {
  listPublishedPictures,
  listPictureTags,
  listPictureCategories,
  type PictureListRow,
} from "@/lib/pictures";
import { PICTURES_PER_PAGE } from "@/lib/constants";
import { PictureCard, pictureHref, type PictureCardData } from "@/components/PictureCard";
import { PictureFilterBar } from "@/components/PictureFilterBar";
import { Pagination } from "@/components/Pagination";
import { AdSlot } from "@/components/AdSlot";
import { AD_300x250_HTML } from "@/lib/ad-config";
import { isPictureSectionEnabled, getSiteConfig } from "@/lib/config";
import { enToBnNumber, timeAgoBn } from "@/lib/utils";
import { JsonLd } from "@/components/JsonLd";
import { buildListingJsonLd } from "@/lib/jsonld";

/**
 * Shared shell for `/pictures`, `/pictures/page/[num]` and the tag /
 * category filtered variants.
 *
 * Mirrors the video list shell: dense grid, `gap-2`, no card chrome, and a
 * lead item on page 1 using the same density rules.
 *
 * Ad rule — exactly 3 ad cells on the page:
 *   Hero → 3 pictures → ad 1 → 3 pictures → ad 2 → remainder (with ad 3
 *   placed at the midpoint of the remainder if it's long).
 *
 * The 3 ads each sit in their own grid slot so a 300×250 occupies exactly
 * the space one picture card would — rows stay flush.
 */

const TOTAL_ADS_PER_PAGE = 3;

interface ShellProps {
  title: string;
  subtitle: string;
  currentPage: number;
  /** The active tag filter (a tag name, not a slug). */
  activeTag?: string | null;
  /** The active category filter (a category name, not a slug). */
  activeCategory?: string | null;
  /**
   * The base URL for pagination. It changes with the active filter so
   * page 2 of a filtered list stays inside the filter.
   */
  paginationBase?: string;
  /** Hide the filter bar (used by the tag pages, which show their own). */
  showFilters?: boolean;
}

export function toCardData(row: PictureListRow): PictureCardData {
  return {
    id: row.id,
    publicSlug: row.public_slug,
    title: row.title,
    coverUrl: row.cover_url,
    imageCount: row.image_count || row.images?.length || 0,
    modelName: row.model_name,
    channelName: row.channel_name,
    publishedAt: row.published_at,
    // Our own view count — never the provider's scraped counter.
    viewCount: row.view_count,
  };
}

export async function PictureListShell({
  title,
  subtitle,
  currentPage,
  activeTag = null,
  activeCategory = null,
  paginationBase = "/pictures/page",
  showFilters = true,
}: ShellProps) {
  // Site-wide kill switch — 404 (not an empty shelf) so the picture
  // section drops out of the index instead of lingering as a stub page.
  if (!isPictureSectionEnabled()) notFound();

  const [{ pictures, total, totalPages }, tags, categories] = await Promise.all(
    [
      listPublishedPictures({
        page: currentPage,
        tag: activeTag,
        category: activeCategory,
      }),
      showFilters ? listPictureTags().catch(() => []) : Promise.resolve([]),
      showFilters
        ? listPictureCategories().catch(() => [])
        : Promise.resolve([]),
    ],
  );
  const list = pictures.slice(0, PICTURES_PER_PAGE);

  const segments: PictureListRow[][] = [];
  let working = list;
  for (let i = 0; i < TOTAL_ADS_PER_PAGE - 1 && working.length > 0; i++) {
    const share = Math.max(
      3,
      Math.ceil(working.length / (TOTAL_ADS_PER_PAGE - i)),
    );
    const take = Math.min(working.length, share);
    segments.push(working.slice(0, take));
    working = working.slice(take);
  }
  if (working.length > 0) segments.push(working);
  while (segments.length > 0 && segments[segments.length - 1].length === 0) {
    segments.pop();
  }

  return (
    <main className="container-page min-h-[70vh] py-6 sm:py-8">
      <JsonLd
        data={buildListingJsonLd({
          site: getSiteConfig(),
          url: `${getSiteConfig().url.endsWith("/") ? getSiteConfig().url.slice(0, -1) : getSiteConfig().url}/pictures${currentPage > 1 ? `/page/${currentPage}` : ""}`,
          name: title,
          description: subtitle,
          pageNumber: currentPage,
          totalPages,
          items: list.map((p) => ({
            url: `${getSiteConfig().url.endsWith("/") ? getSiteConfig().url.slice(0, -1) : getSiteConfig().url}${pictureHref(p)}`,
            name: p.title,
            // No `image:` — the scraped adult-site cover used to leak into
            // the structured data, and the social crawlers read the
            // JSON-LD payload as well as the meta tags.
          })),
        })}
      />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-fg sm:text-3xl">
            <Images className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            {title}
          </h1>
          <p className="mt-1 max-w-prose text-sm leading-6 text-fg-muted">
            {subtitle}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-fg-subtle">
          {currentPage > 1 ? (
            <Link href="/pictures" className="underline-offset-2 hover:underline">
              প্রথম পাতা
            </Link>
          ) : null}
          <span>মোট {enToBnNumber(total)}টি গ্যালারি</span>
        </div>
      </div>

      {/* The active filter, shown as a removable chip so the visitor can
          see at a glance that the list is filtered — and get back to the
          full list in one click. */}
      {activeTag || activeCategory ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-subtle">
            ফিল্টার
          </span>
          {activeTag ? (
            <FilterChip kind="ট্যাগ" value={activeTag} href="/pictures" />
          ) : null}
          {activeCategory ? (
            <FilterChip
              kind="ক্যাটাগরি"
              value={activeCategory}
              href="/pictures"
            />
          ) : null}
        </div>
      ) : null}

      {showFilters ? (
        <PictureFilterBar
          tags={tags.map((t) => ({ name: t.tag, count: t.count }))}
          categories={categories.map((c) => ({
            name: c.category,
            count: c.count,
          }))}
          activeTag={activeTag}
          activeCategory={activeCategory}
        />
      ) : null}

      {list.length === 0 ? (
        <EmptyState filtered={Boolean(activeTag || activeCategory)} />
      ) : (
        <>
          {/* A plain, uniform grid of standard cards — no special "hero"
              entry. One card design for every gallery keeps the page
              scannable: the visitor compares covers, not card layouts.

              Column count and cover size are tuned for PORTRAIT covers, not
              the video section's 16:9 thumbs.

              Four columns across a 1136px content box leaves each column
              ~275px, and the cover's own `max-w` caps the image at 220px —
              a thumbnail that reads at a glance without eating three
              screens of scroll. The cover's `min-w` (110px) keeps it from
              collapsing in the narrowest columns.

              The grid track still stretches, so the row stays flush — only
              the image stops growing. `mx-auto` centres the capped cover
              in its column, which keeps the ragged-edge problem (a grid
              where each image has a different width) from returning. */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            {segments.flatMap((segment, idx) => [
              ...segment.map((picture) => (
                <PictureCard
                  key={picture.id}
                  picture={toCardData(picture)}
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 220px"
                  coverClassName="mx-auto w-full max-w-[220px]"
                  compact
                />
              )),
              idx < segments.length - 1 ? (
                /* Mobile-only ad cell. On md+ the whole slot is removed
                   (and the grid re-flows) so the desktop shelf stays a
                   clean 4-up picture grid with no 300x250 holes in it. */
                <div
                  key={`ad-${currentPage}-${idx}`}
                  className="flex items-start justify-center pt-1 md:hidden"
                >
                  <AdSlot
                    id={`pictures-ad-${currentPage}-${idx}`}
                    html={AD_300x250_HTML}
                    minHeight={250}
                  />
                </div>
              ) : null,
            ])}
          </div>

          {totalPages > 1 ? (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              baseUrl={paginationBase}
              homeUrl="/pictures"
            />
          ) : null}
        </>
      )}
    </main>
  );
}

/**
 * A removable chip for the active filter.
 *
 * Clicking it drops the filter and returns to the full list.
 */
function FilterChip({
  kind,
  value,
  href,
}: {
  kind: string;
  value: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-full bg-fg px-3 py-1 text-[12px] font-semibold text-surface transition hover:opacity-85"
    >
      <span className="opacity-70">{kind}</span>
      <span className="font-latin">{value}</span>
      <X className="h-3 w-3 opacity-70" />
    </Link>
  );
}

function EmptyState({ filtered = false }: { filtered?: boolean }) {
  if (filtered) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-12 text-center">
        <Images className="mx-auto h-10 w-10 text-fg-subtle" />
        <p className="mt-3 font-semibold text-fg">
          এই ফিল্টারে কোনো গ্যালারি নেই
        </p>
        <p className="mt-1 text-sm text-fg-muted">
          অন্য কোনো ট্যাগ বা ক্যাটাগরি দেখে নিন।
        </p>
        <Link
          href="/pictures"
          className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface-hover"
        >
          সব ছবি দেখুন
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-dashed border-border p-12 text-center">
      <Images className="mx-auto h-10 w-10 text-fg-subtle" />
      <p className="mt-3 font-semibold text-fg">এখনো কোনো ছবির গ্যালারি প্রকাশ হয়নি</p>
      <p className="mt-1 text-sm text-fg-muted">
        নতুন গ্যালারি প্রকাশ হলে এখানে দেখা যাবে।
      </p>
    </div>
  );
}
