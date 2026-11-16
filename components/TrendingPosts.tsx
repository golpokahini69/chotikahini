import Image from "next/image";
import { Eye, Heart, Flame } from "lucide-react";
import { LocalizedLink } from "@/components/LocalizedLink";
import { formatNumber } from "@/lib/i18n/format";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { getTrendingPosts } from "@/lib/trending";

/**
 * Sidebar "trending" widget.
 *
 * Rendered on the server (the sidebar already is one) so the list is part of
 * the HTML: no `/api/trending` request on every page view, no skeleton
 * placeholder, no layout shift and no hydration cost for this widget.
 */
export async function TrendingPosts({ locale: localeProp }: { locale?: Locale } = {}) {
  const locale = localeProp ?? DEFAULT_LOCALE;

  let posts: Awaited<ReturnType<typeof getTrendingPosts>> = [];
  try {
    posts = await getTrendingPosts();
  } catch {
    return null;
  }

  if (posts.length === 0) return null;

  return (
    <div className="space-y-2.5">
      {posts.map((post, i) => (
        <LocalizedLink
          key={post.uid || post.slug}
          href={`/${post.uid || post.slug}`}
          className="flex items-center gap-3 p-2.5 rounded-xl bg-surface border border-border hover:border-fg/30 transition-all group"
        >
          <span className="text-base font-bold text-fg-subtle w-5 text-center leading-none flex-shrink-0">
            {formatNumber(i + 1, locale)}
          </span>
          {post.cover ? (
            <div className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0 border border-border relative">
              <Image src={post.cover} alt={post.title} width={36} height={36} sizes="36px" className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="w-9 h-9 rounded-lg bg-surface-alt flex items-center justify-center flex-shrink-0 text-fg-subtle">
              <Flame className="w-4 h-4" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-fg group-hover:text-fg-muted transition-colors line-clamp-1">
              {post.title}
            </p>
            {post.categoryName && (
              <p className="text-[10px] text-fg-subtle mt-0.5">{post.categoryName}</p>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-fg-muted flex-shrink-0">
            <span className="flex items-center gap-1" title={locale === "en" ? "Total views" : "মোট ভিউ"}>
              <Eye className="w-3.5 h-3.5" />
              <span>{formatNumber(post.viewCount, locale)}</span>
            </span>
            {post.likeCount > 0 && (
              <span className="flex items-center gap-1">
                <Heart className="w-3 h-3 fill-red-500 text-red-500" />
                <span>{formatNumber(post.likeCount, locale)}</span>
              </span>
            )}
            </div>
        </LocalizedLink>
      ))}
    </div>
  );
}
