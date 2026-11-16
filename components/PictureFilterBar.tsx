import Link from "next/link";
import { Tag as TagIcon, Shapes } from "lucide-react";
import { enToBnNumber } from "@/lib/utils";
import {
  pictureTagSlug,
  pictureTagFromSlug,
} from "@/lib/picture-tag-utils";

/**
 * The tag / category filter bar for the picture section.
 *
 * Two independent filters:
 *   • ট্যাগ   → /pictures/tag/<slug>
 *   • ক্যাটাগরি → /pictures/category/<slug>
 *
 * Both are rendered as a horizontal row of pills that scrolls sideways on
 * narrow screens. The active one is highlighted; the rest are plain.
 *
 * The bar is a *navigation* aid, not a client-side widget — every filter
 * is a real URL, so a filtered gallery can be linked to, bookmarked and
 * indexed by search engines.
 */

export interface PictureFilterItem {
  name: string;
  count: number;
}

interface Props {
  tags?: PictureFilterItem[];
  categories?: PictureFilterItem[];
  activeTag?: string | null;
  activeCategory?: string | null;
  /** How many pills to show before the "সব" link. */
  limit?: number;
}

export function PictureFilterBar({
  tags = [],
  categories = [],
  activeTag = null,
  activeCategory = null,
  limit = 18,
}: Props) {
  const visibleTags = tags.slice(0, limit);
  const visibleCategories = categories.slice(0, limit);

  if (visibleTags.length === 0 && visibleCategories.length === 0) return null;

  return (
    <div className="mb-5 space-y-3">
      {visibleTags.length > 0 ? (
        <FilterRow
          label="ট্যাগ"
          icon={<TagIcon className="h-3.5 w-3.5" />}
          items={visibleTags}
          active={activeTag}
          hrefFor={(name) => `/pictures/tag/${pictureTagSlug(name)}`}
          clearHref="/pictures"
        />
      ) : null}

      {visibleCategories.length > 0 ? (
        <FilterRow
          label="ক্যাটাগরি"
          icon={<Shapes className="h-3.5 w-3.5" />}
          items={visibleCategories}
          active={activeCategory}
          hrefFor={(name) => `/pictures/category/${pictureTagSlug(name)}`}
          clearHref="/pictures"
        />
      ) : null}
    </div>
  );
}

function FilterRow({
  label,
  icon,
  items,
  active,
  hrefFor,
  clearHref,
}: {
  label: string;
  icon: React.ReactNode;
  items: PictureFilterItem[];
  active: string | null;
  hrefFor: (name: string) => string;
  clearHref: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-subtle">
        {icon}
        {label}
      </span>

      <div className="-mx-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <FilterPill
          href={clearHref}
          active={!active}
          label="সব"
          count={null}
        />
        {items.map((item) => (
          <FilterPill
            key={item.name}
            href={hrefFor(item.name)}
            active={
              active !== null &&
              pictureTagFromSlug(active) === item.name.toLowerCase()
            }
            label={item.name}
            count={item.count}
          />
        ))}
      </div>
    </div>
  );
}

function FilterPill({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number | null;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      className={
        active
          ? "shrink-0 whitespace-nowrap rounded-full bg-fg px-3 py-1 text-[12px] font-semibold text-surface transition"
          : "shrink-0 whitespace-nowrap rounded-full border border-border px-3 py-1 text-[12px] font-medium text-fg-muted transition hover:border-fg-muted hover:text-fg"
      }
    >
      {label}
      {count !== null ? (
        <span className={active ? "ml-1.5 opacity-70" : "ml-1.5 opacity-60"}>
          {enToBnNumber(count)}
        </span>
      ) : null}
    </Link>
  );
}
