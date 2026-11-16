import { ArrowRight } from "lucide-react";
import { PostGridWithAds } from "@/components/PostGridWithAds";
import { Sidebar } from "@/components/Sidebar";
import { LocalizedLink } from "@/components/LocalizedLink";
import { t } from "@/lib/i18n/messages";
import { formatNumber } from "@/lib/i18n/format";
import { localizeCategoryName } from "@/lib/i18n/overrides";
import type { Locale } from "@/lib/i18n/locale";
import type { Category } from "@/lib/config";
import type { PostMeta } from "@/lib/posts";

/**
 * The category listing page, shared by both locales.
 *
 * Category names are Bangla in the database; the English locale uses the
 * curated override map in `lib/i18n/overrides.ts`.
 */
export function CategoryView({
  locale,
  category,
  allCategories,
  posts,
  categoryCounts,
}: {
  locale: Locale;
  category: Category | undefined;
  allCategories: Category[];
  posts: PostMeta[];
  categoryCounts?: Map<string, number>;
}) {
  const name = localizeCategoryName(category?.id || "", category?.name, locale);

  return (
    <div className="article-layout py-8 sm:py-10">
      <div>
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-1 w-1 rounded-full bg-fg" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
              {t(locale, "sidebar.categories")}
            </h2>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg">
            {name}
          </h1>
          {category?.description && (
            <p className="text-sm text-fg-muted mt-1">{category.description}</p>
          )}
          <p className="text-xs text-fg-subtle mt-2">
            {locale === "en"
              ? `${formatNumber(posts.length, locale)} stories in total`
              : `মোট ${formatNumber(posts.length, locale)}টি লেখা`}
          </p>
        </section>

        {/* Category navigation — rounded cards.

            Sibling categories with no published stories are skipped: their
            listing pages are soft 404s marked `noindex, follow`, so linking
            to them would send Google to pages we ask it not to index. */}
        <div className="flex flex-wrap gap-2 mb-8">
          {allCategories
            .filter(
              (c) => c.id === category?.id || (categoryCounts?.get(c.id) ?? 0) > 0,
            )
            .map((c) => {
            const isActive = c.id === category?.id;
            return (
              <LocalizedLink
                key={c.id}
                href={`/categories/${c.id}`}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm transition-all duration-200 ${
                  isActive
                    ? "border-fg bg-fg text-surface font-medium"
                    : "border-border bg-surface text-fg-muted hover:text-fg hover:border-fg/30 hover:bg-surface-hover"
                }`}
              >
                {localizeCategoryName(c.id, c.name, locale)}
                <ArrowRight
                  className={`h-3.5 w-3.5 transition-transform ${
                    isActive ? "rotate-90" : ""
                  }`}
                />
              </LocalizedLink>
            );
          })}
        </div>

        {posts.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-border bg-surface-alt">
            <p className="text-sm text-fg-muted">
              {t(locale, "categories.empty")}
            </p>
          </div>
        ) : (
          <PostGridWithAds posts={posts} adInterval={4} locale={locale} />
        )}
      </div>

      <Sidebar locale={locale} />
    </div>
  );
}
