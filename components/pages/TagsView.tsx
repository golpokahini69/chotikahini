import { Tag } from "lucide-react";
import { LocalizedLink } from "@/components/LocalizedLink";
import { t } from "@/lib/i18n/messages";
import { tagSlug } from "@/lib/tag-utils";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The tag cloud page, shared by both locales.
 */
export function TagsView({
  locale,
  tags,
}: {
  locale: Locale;
  tags: { tag: string; count: number }[];
}) {
  return (
    <div className="container-page py-10 sm:py-14">
      <div className="flex items-center gap-2 mb-3">
        <span className="h-1 w-1 rounded-full bg-fg" />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
          {t(locale, "sidebar.tags")}
        </h2>
      </div>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg mb-2">
        {t(locale, "tags.heading")}
      </h1>
      <p className="text-sm text-fg-muted mb-8">
        {t(locale, "tags.subheading")}
      </p>

      {tags.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-border bg-surface-alt">
          <p className="text-sm text-fg-muted">{t(locale, "tags.empty")}</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {tags.map((t) => (
            <LocalizedLink
              key={t.tag}
              href={`/tags/${tagSlug(t.tag)}`}
              className="inline-flex items-center gap-2 rounded-2xl border border-border bg-surface px-5 py-3 text-sm font-medium text-fg-muted hover:text-fg hover:bg-surface-hover hover:border-fg/30 transition-all duration-200"
            >
              <Tag className="h-4 w-4" />
              <span>{t.tag}</span>
              <span className="text-xs text-fg-subtle">({t.count})</span>
            </LocalizedLink>
          ))}
        </div>
      )}
    </div>
  );
}
