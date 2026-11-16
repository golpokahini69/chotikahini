import { ArrowLeft, ArrowRight } from "lucide-react";
import { LocalizedLink } from "@/components/LocalizedLink";
import { t } from "@/lib/i18n/messages";
import { formatNumber } from "@/lib/i18n/format";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  baseUrl?: string; // e.g. "/page" or "/featured/page"
  homeUrl?: string; // e.g. "/" or "/featured"
  /**
   * The active locale. Drives the digit rendering (Bengali vs ASCII) and
   * the button labels. Defaults to Bangla so existing call sites keep their
   * current behaviour.
   */
  locale?: Locale;
}

export function Pagination({
  currentPage,
  totalPages,
  baseUrl = "/page",
  homeUrl = "/",
  locale = DEFAULT_LOCALE,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const getPageUrl = (page: number) => {
    if (page === 1) return homeUrl;
    return `${baseUrl}/${page}`;
  };

  // Generate pagination items array with smart truncation
  const getPageNumbers = (): (number | "...")[] => {
    const pages: (number | "...")[] = [];

    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);

      if (currentPage > 3) {
        pages.push("...");
      }

      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);

      for (let i = start; i <= end; i++) {
        if (i > 1 && i < totalPages) {
          pages.push(i);
        }
      }

      if (currentPage < totalPages - 2) {
        pages.push("...");
      }

      pages.push(totalPages);
    }

    return pages;
  };

  const pages = getPageNumbers();
  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  return (
    <nav className="mt-10 flex flex-col items-center gap-4" aria-label="Pagination Navigation">
      <div className="flex items-center justify-center flex-wrap gap-1.5 sm:gap-2">
        {/* Previous Button */}
        {hasPrev ? (
          <LocalizedLink
            href={getPageUrl(currentPage - 1)}
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium bg-surface-alt text-fg border border-border hover:bg-surface-hover transition-colors"
            aria-label={t(locale, "pagination.previousPage")}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t(locale, "pagination.previous")}</span>
          </LocalizedLink>
        ) : (
          <span className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium bg-surface-alt/50 text-fg-subtle border border-border/50 cursor-not-allowed opacity-50">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t(locale, "pagination.previous")}</span>
          </span>
        )}

        {/* Page Number Buttons */}
        {pages.map((p, idx) => {
          if (p === "...") {
            return (
              <span
                key={`ellipsis-${idx}`}
                className="w-7 sm:w-9 h-8 sm:h-9 flex items-center justify-center text-xs text-fg-subtle font-bold"
              >
                ...
              </span>
            );
          }

          const isCurrent = p === currentPage;

          return (
            <LocalizedLink
              key={`page-${p}`}
              href={getPageUrl(p)}
              className={`w-8 sm:w-10 h-8 sm:h-10 flex items-center justify-center rounded-xl text-xs sm:text-sm font-bold transition-all ${
                isCurrent
                  ? "bg-fg text-surface shadow-md ring-2 ring-fg/20 scale-105"
                  : "bg-surface-alt text-fg hover:bg-surface-hover border border-border hover:border-fg/30"
              }`}
              aria-current={isCurrent ? "page" : undefined}
            >
              {formatNumber(p, locale)}
            </LocalizedLink>
          );
        })}

        {/* Next Button */}
        {hasNext ? (
          <LocalizedLink
            href={getPageUrl(currentPage + 1)}
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium bg-fg text-surface hover:opacity-90 transition-opacity"
            aria-label={t(locale, "pagination.nextPage")}
          >
            <span className="hidden sm:inline">{t(locale, "pagination.next")}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </LocalizedLink>
        ) : (
          <span className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium bg-surface-alt/50 text-fg-subtle border border-border/50 cursor-not-allowed opacity-50">
            <span className="hidden sm:inline">{t(locale, "pagination.next")}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </span>
        )}
      </div>

      <p className="text-xs text-fg-subtle">
        {t(locale, "pagination.pageOf", {
          n: formatNumber(currentPage, locale),
          m: formatNumber(totalPages, locale),
        })}
      </p>
    </nav>
  );
}
