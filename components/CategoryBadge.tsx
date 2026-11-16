import { LocalizedLink } from "@/components/LocalizedLink";
import { SectionIcon } from "@/components/SectionIcon";
import { localizeCategoryName } from "@/lib/i18n/overrides";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";

export function CategoryBadge({
  categoryId,
  categoryName,
  size = "sm",
  locale = DEFAULT_LOCALE,
}: {
  categoryId: string;
  categoryName?: string;
  size?: "sm" | "lg";
  locale?: Locale;
}) {
  return (
    <LocalizedLink
      href={`/categories/${categoryId}`}
      className={`chip-category ${
        size === "lg" ? "text-sm px-4 py-3 gap-3" : "text-xs px-3 py-1 gap-1.5"
      }`}
      data-category={categoryName || categoryId}
    >
      <SectionIcon
        seed={categoryId}
        className={size === "lg" ? "h-12 w-12 shrink-0" : "h-[18px] w-[18px] shrink-0"}
      />
      {localizeCategoryName(categoryId, categoryName, locale)}
    </LocalizedLink>
  );
}
