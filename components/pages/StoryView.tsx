import Link from "next/link";
import { Calendar, Clock, Tag, User, BadgeCheck, AlertCircle, Layers } from "lucide-react";
import { formatDateTime } from "@/lib/i18n/format";
import { enToBnNumber } from "@/lib/utils";
import { t } from "@/lib/i18n/messages";
import { localizeCategoryName } from "@/lib/i18n/overrides";
import { localizeSiteConfig } from "@/lib/i18n/site-text";
import { StoryWithVideos } from "@/components/StoryWithVideos";
import { AdSlot } from "@/components/AdSlot";
import { CategoryBadge } from "@/components/CategoryBadge";
import { PlaceholderCover } from "@/components/PlaceholderCover";
import { RelatedPosts } from "@/components/RelatedPosts";
import { CommentSection } from "@/components/comments/CommentSection";
import { CoAuthors } from "@/components/CoAuthors";
import { ReadingProgress } from "@/components/ReadingProgress";
import { Sidebar } from "@/components/Sidebar";
import { PreviousPost } from "@/components/PreviousPost";
import { NextPost } from "@/components/NextPost";
import { CopyAttribution } from "@/components/CopyAttribution";
import { InlineAttribution } from "@/components/InlineAttribution";
import { TableOfContents } from "@/components/TableOfContents";
import { AuthorSocialIcons } from "@/components/AuthorSocialIcons";
import { SavePostButton } from "@/components/SavePostButton";
import { RecordHistory } from "@/components/RecordHistory";
import { ReadingProgressTracker } from "@/components/ReadingProgressTracker";
import { PageVisitTracker } from "@/components/PageVisitTracker";
import { CoverLightbox } from "@/components/CoverLightbox";
import { UserAvatar } from "@/components/UserAvatar";
import { LikePostButton } from "@/components/LikePostButton";
import { PostReactions } from "@/components/PostReactions";
import { ShareButtons } from "@/components/ShareButtons";
import { ReportButton } from "@/components/ReportButton";
import { FontSizeControl } from "@/components/FontSizeControl";
import { ViewCounter } from "@/components/ViewCounter";
import { ReadingMode } from "@/components/ReadingMode";
import { LocalizedLink } from "@/components/LocalizedLink";
import { AD_300x250_HTML } from "@/lib/ad-config";
import type { JsonLdGraph } from "@/lib/seo";
import { tagSlug } from "@/lib/tag-utils";
import type { Locale } from "@/lib/i18n/locale";
import type { Post } from "@/lib/posts";
import type { SiteConfig, Author } from "@/lib/config";

const POST_PAGE_AD_HTML = AD_300x250_HTML;

/**
 * The story detail page, shared by both locales.
 *
 * The story body is authored in Bangla and is deliberately left untouched —
 * only the chrome around it is translated. The body is wrapped in a
 * `lang="bn"` element so screen readers pronounce it correctly even when
 * the surrounding page is English.
 */
export function StoryView({
  locale,
  post,
  site,
  authorMeta,
  jsonLd,
  related,
  isPendingPreview,
  partIndex,
  series,
}: {
  locale: Locale;
  post: Post;
  site: SiteConfig;
  authorMeta: Author | undefined;
  jsonLd: JsonLdGraph;
  related: Post[];
  isPendingPreview: boolean;
  /**
   * Set when several stories share this headline. The visible title then
   * carries a part number so readers — and Google — can tell the pieces
   * apart.
   */
  partIndex?: number;
  /**
   * The series this story belongs to, rendered as a link back to the
   * series page.
   */
  series?: { id: string; title: string } | null;
}) {
  const localizedSite = localizeSiteConfig(site, locale);
  const siteUrl = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  const storyUrl =
    locale === "en"
      ? `${siteUrl}/en/${post.uid || post.slug}`
      : `${siteUrl}/${post.uid || post.slug}`;

  // Keyword-enriched image alt text for SEO
  const imageAlt = `${post.title} — ${post.categoryName} বিভাগের ${localizedSite.shortName} গল্প | ${localizedSite.title}`;

  return (
    <>
      <RecordHistory slug={post.slug} title={post.title} cover={post.cover || ""} />
      <ReadingProgressTracker postSlug={post.slug} />
      <PageVisitTracker slug={post.slug} />
      <ReadingProgress />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="article-layout py-8 sm:py-10">
        <article>
          {isPendingPreview && (
            <div className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 flex items-center gap-3 text-sm font-medium animate-in fade-in duration-200">
              <AlertCircle className="w-6 h-6 shrink-0 text-amber-500" />
              <div>
                <p className="font-bold text-base">
                  {t(locale, "story.pendingTitle")}
                </p>
                <p className="text-xs opacity-90">
                  {t(locale, "story.pendingBody")}
                </p>
              </div>
            </div>
          )}

          {(post.previousPost || post.nextPost) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <PreviousPost slug={post.previousPost} locale={locale} />
              <NextPost slug={post.nextPost} locale={locale} />
            </div>
          )}

          <header className="mb-8 space-y-4">
            <CategoryBadge
              categoryId={post.categoryId}
              categoryName={localizeCategoryName(
                post.categoryId,
                post.categoryName,
                locale,
              )}
              size="lg"
            />

            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight leading-snug text-fg">
              {post.title}
              {partIndex && partIndex > 1 && (
                <span className="text-fg-muted font-semibold">
                  {" "}
                  — পর্ব {enToBnNumber(partIndex)}
                </span>
              )}
            </h1>

            {post.description && (
              <p className="text-sm sm:text-base text-fg-muted leading-relaxed font-normal">
                {post.description}
              </p>
            )}

            {/* Link back to the series this story belongs to.

                The /series index only exposes its episode links after the
                reader expands that story's accordion panel, which happens in
                the browser — a crawler reading the server-rendered HTML
                never sees them. This link is in the initial HTML, so the
                series page has a real inbound link from each of its
                episodes. */}
            {series ? (
              <p className="flex items-center gap-1.5 text-xs text-fg-muted">
                <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>সিরিজ:</span>
                <LocalizedLink
                  href={`/series/${series.id}`}
                  className="font-semibold text-accent hover:underline"
                >
                  {series.title}
                </LocalizedLink>
              </p>
            ) : null}

            {/* Ultra-Modern Editorial Hero Meta Bar */}
            <div className="pt-2">
              {/* Mobile-Only Minimalist Author Pill */}
              <div className="lg:hidden flex items-center justify-between gap-3 mb-4 bg-gradient-to-r from-accent/10 via-surface-alt to-transparent p-2.5 pl-3 rounded-2xl border border-accent/15">
                <LocalizedLink
                  href={`/authors/${encodeURIComponent(post.authorUsername || post.authorId)}`}
                  className="flex items-center gap-2.5 min-w-0 group"
                >
                  <UserAvatar
                    src={authorMeta?.image}
                    name={post.authorName}
                    userId={post.authorId}
                    size="md"
                    className="ring-2 ring-accent/30 group-hover:scale-105 transition-transform"
                  />
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase font-bold tracking-wider text-accent">
                      {t(locale, "story.author")}
                    </p>
                    <p className="text-xs font-bold text-fg group-hover:text-accent transition-colors truncate flex items-center gap-1">
                      {post.authorName}
                      {post.authorVerified && (
                        <BadgeCheck className="w-3.5 h-3.5 text-blue-500 fill-blue-500/20 shrink-0" />
                      )}
                    </p>
                  </div>
                </LocalizedLink>

                <LocalizedLink
                  href={`/authors/${encodeURIComponent(post.authorUsername || post.authorId)}`}
                  className="px-3 py-1 text-[11px] font-bold rounded-full bg-accent text-surface hover:opacity-90 transition-opacity shrink-0"
                >
                  {t(locale, "story.viewProfile")}
                </LocalizedLink>
              </div>

              {/* Clean Editorial Stats & Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-fg-subtle pt-2 border-t border-border/60">
                <div className="flex flex-wrap items-center gap-3 font-medium">
                  <span className="flex items-center gap-1.5 hover:text-fg transition-colors">
                    <Calendar className="h-3.5 w-3.5 text-accent shrink-0" />
                    <span>{formatDateTime(post.publishedAt, locale)}</span>
                  </span>

                  <span className="text-border">/</span>

                  <span className="flex items-center gap-1.5 hover:text-fg transition-colors">
                    <Clock className="h-3.5 w-3.5 text-accent shrink-0" />
                    <span>{post.readingTime}</span>
                  </span>

                  <span className="text-border">/</span>

                  <ViewCounter slug={post.slug} />
                </div>

                {/* Like, Save, Report & Reading Mode Actions */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <ReadingMode
                    title={post.title}
                    authorName={post.authorName}
                    categoryName={post.categoryName}
                    readingTime={post.readingTime}
                    content={post.content}
                  />
                  <LikePostButton postSlug={post.slug} />
                  <SavePostButton postSlug={post.slug} />
                  <ReportButton targetType="story" targetId={post.slug} />
                </div>
              </div>

              {/* Story reactions (❤️ 👍 😂 😮) — separate from the like button */}
              <div className="mt-4">
                <PostReactions postSlug={post.slug} />
              </div>
            </div>
          </header>

          {post.cover ? (
            <div className="mb-8 -mx-4 sm:-mx-0">
              <CoverLightbox src={post.cover} alt={imageAlt} />
            </div>
          ) : (
            <div className="mb-8 rounded-2xl overflow-hidden shadow-lg shadow-black/10 dark:shadow-black/40 ring-1 ring-black/5 dark:ring-white/5">
              <PlaceholderCover
                title={post.title}
                categoryId={post.categoryId}
                categoryName={post.categoryName}
                className="w-full"
                style={{ aspectRatio: "16/9", maxHeight: "420px" }}
              />
            </div>
          )}

          {/* The story body stays Bangla. The explicit `lang` attribute
              tells assistive technology to pronounce it with Bengali
              phonetics even though the document language is English. */}
          <div lang="bn">
            <StoryWithVideos source={post.content} />
          </div>

          <TableOfContents content={post.content} />

          <AdSlot id="post-inline-ad" html={POST_PAGE_AD_HTML} className="my-8" />

          {/* Share buttons (Bottom of article) */}
          <div className="mt-8 pt-6 border-t border-border flex items-center">
            <ShareButtons title={post.title} url={storyUrl} />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-8 pt-8 border-t border-border">
            <InlineAttribution />
            <AuthorSocialIcons
              website={authorMeta?.website}
              facebook={authorMeta?.facebook}
            />
          </div>

          {(post.previousPost || post.nextPost) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8">
              <PreviousPost slug={post.previousPost} locale={locale} />
              <NextPost slug={post.nextPost} locale={locale} />
            </div>
          )}

          <CopyAttribution />

          {post.tags.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <LocalizedLink
                  key={tag}
                  href={`/tags/${tagSlug(tag)}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-alt px-2.5 py-1 text-xs font-medium text-fg-muted hover:text-fg hover:border-fg/30 transition-colors"
                >
                  <Tag className="h-3 w-3" />
                  {tag}
                </LocalizedLink>
              ))}
            </div>
          )}

          <CommentSection postSlug={post.slug} authorId={post.authorId} />
          <CoAuthors storyUid={post.uid || post.slug} />
          <RelatedPosts posts={related} locale={locale} />
        </article>

        <Sidebar
          locale={locale}
          authorId={post.authorId}
          authorName={post.authorName}
          authorImage={post.authorImage}
          authorBio={post.authorBio}
          authorVerified={post.authorVerified}
          authorUsername={post.authorUsername}
        />
      </div>
      <FontSizeControl />
    </>
  );
}
