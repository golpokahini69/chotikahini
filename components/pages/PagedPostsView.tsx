import { PostGridWithAds } from "@/components/PostGridWithAds";
import { Pagination } from "@/components/Pagination";
import { Sidebar } from "@/components/Sidebar";
import { t } from "@/lib/i18n/messages";
import { formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { PostMeta } from "@/lib/posts";

/**
 * The paginated story listing (`/page/2`, `/en/page/2`, …).
 *
 * Shared by both locales — only the headings and the digits differ.
 */
export function PagedPostsView({
  locale,
  pageNum,
  totalPages,
  posts,
}: {
  locale: Locale;
  pageNum: number;
  totalPages: number;
  posts: PostMeta[];
}) {
  return (
    <div className="article-layout py-8 sm:py-10">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="h-1 w-1 rounded-full bg-fg" />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
            {t(locale, "pagination.pageOf", {
              n: formatNumber(pageNum, locale),
              m: formatNumber(totalPages, locale),
            })}
          </h2>
        </div>

        {/* Every indexable page needs exactly one H1. `/page/2` and friends
            previously had none, so Google had no top-level heading to match
            the page title against. */}
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg mb-1">
          {locale === "en"
            ? `All stories — page ${pageNum}`
            : `সব লেখা — পাতা ${formatNumber(pageNum, locale)}`}
        </h1>

        {posts.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-border bg-surface-alt">
            <p className="text-sm text-fg-muted">
              {locale === "en"
                ? "There are no stories on this page"
                : "এই পাতায় কোনো লেখা নেই"}
            </p>
          </div>
        ) : (
          <PostGridWithAds posts={posts} adInterval={4} locale={locale} />
        )}

        <Pagination
          currentPage={pageNum}
          totalPages={totalPages}
          baseUrl="/page"
          homeUrl="/"
          locale={locale}
        />
      </div>

      <Sidebar locale={locale} />
    </div>
  );
}
