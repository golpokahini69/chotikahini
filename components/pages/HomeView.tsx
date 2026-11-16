import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PostGridWithAds } from "@/components/PostGridWithAds";
import { Pagination } from "@/components/Pagination";
import { HomeVideoStrip } from "@/components/HomeVideoStrip";
import { HomePictureStrip } from "@/components/HomePictureStrip";
import { FeaturedCarousel } from "@/components/FeaturedCarousel";
import { Sidebar } from "@/components/Sidebar";
import { LocalizedLink } from "@/components/LocalizedLink";
import { t } from "@/lib/i18n/messages";
import { formatNumber } from "@/lib/i18n/format";
import { localizeSiteConfig } from "@/lib/i18n/site-text";
import type { Locale } from "@/lib/i18n/locale";
import type { SiteConfig } from "@/lib/config";
import type { PostMeta } from "@/lib/posts";

/**
 * The homepage, shared by both locales.
 *
 * All copy comes from the message catalogue and all dates/numbers from the
 * locale-aware formatters, so the Bangla page renders exactly as it did
 * before and the English page is its translated counterpart.
 */
export function HomeView({
  locale,
  site,
  featured,
  latest,
  totalPosts,
  totalPages,
  videoOn,
  pictureOn,
}: {
  locale: Locale;
  site: SiteConfig;
  featured: PostMeta[];
  latest: PostMeta[];
  totalPosts: number;
  totalPages: number;
  videoOn: boolean;
  pictureOn: boolean;
}) {
  const localizedSite = localizeSiteConfig(site, locale);

  return (
    <div className="article-layout py-8 sm:py-10">
      <div className="min-w-0">
        {/* ── Title strip ─────────────────────────────────────── */}
        <header className="mb-7 sm:mb-9">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-[28px]">
                {localizedSite.title}
              </h1>
              <p className="mt-1 text-sm leading-6 text-fg-muted">
                {localizedSite.tagline}
              </p>
            </div>
            {/* Content-type switch as plain text. The video strip right
                below already proves both modes exist, so badges here only
                crowd the H1 — and another 24px of chips pushed the fold down. */}
            <div className="hidden shrink-0 gap-5 text-xs font-semibold sm:flex">
              {/* Hidden when the video section is switched off, so the
                  header never links to a 404. */}
              {videoOn ? (
                <LocalizedLink
                  href="/videos"
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  {t(locale, "home.videos")}
                </LocalizedLink>
              ) : null}
              {pictureOn ? (
                <LocalizedLink
                  href="/pictures"
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  {t(locale, "home.pictures")}
                </LocalizedLink>
              ) : null}
              <LocalizedLink href="/posts" className="text-fg-subtle hover:text-fg">
                {t(locale, "home.stories")}
              </LocalizedLink>
            </div>
          </div>
        </header>

        {/* ── Lead module: video strip ─────────────────────────── */}
        <HomeVideoStrip />

        {/* ── Picture strip: the gallery series ────────────────── */}
        <HomePictureStrip />

        {/* ── Stories: featured then latest ───────────────────── */}
        {featured.length > 0 ? (
          <section className="mb-8">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-amber-500" />
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
                    {t(locale, "home.featuredStories")}
                  </h2>
                </div>
                <p className="mt-1 text-xs text-fg-muted">
                  {t(locale, "home.thisWeekBest")}
                </p>
              </div>
              <LocalizedLink
                href="/featured"
                className="inline-flex items-center gap-1 text-xs font-semibold text-fg-subtle hover:text-fg"
              >
                {t(locale, "home.allFeatured")}
                <ArrowRight className="h-3.5 w-3.5" />
              </LocalizedLink>
            </div>
            <FeaturedCarousel posts={featured} locale={locale} />
          </section>
        ) : null}

        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-fg" />
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
                  {t(locale, "home.latestStories")}
                </h2>
              </div>
              <p className="text-xs text-fg-muted">
                {t(locale, "home.latestCount", {
                  count: formatNumber(totalPosts, locale),
                })}
              </p>
            </div>
          </div>

          {latest.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface-alt py-16 text-center">
              <p className="text-sm text-fg-muted">
                {t(locale, "home.noStoriesTitle")}
              </p>
              <p className="mt-2 text-xs text-fg-subtle">
                {t(locale, "home.noStoriesBody")}
              </p>
            </div>
          ) : (
            <PostGridWithAds posts={latest} adInterval={4} locale={locale} />
          )}

          {totalPages > 1 ? (
            <Pagination
              currentPage={1}
              totalPages={totalPages}
              baseUrl="/page"
              homeUrl="/"
              locale={locale}
            />
          ) : null}
        </section>
      </div>

      <Sidebar locale={locale} />

      {/* SEO content — keyword-rich description of the site */}
      <section className="mt-16 border-t border-border pt-10">
        <div className="mx-auto max-w-3xl space-y-4 text-sm leading-relaxed text-fg-muted">
          <h2 className="text-lg font-bold text-fg">
            {localizedSite.title} — {t(locale, "home.videosAndStories")}
          </h2>
          <p>{t(locale, "home.seoBody1")}</p>
          <p>{t(locale, "home.seoBody2")}</p>
          <p className="text-xs text-fg-subtle">
            {t(locale, "home.disclaimer")}
          </p>
        </div>
      </section>
    </div>
  );
}
