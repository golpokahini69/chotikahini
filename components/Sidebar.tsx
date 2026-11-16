import Image from "next/image";
import { BadgeCheck } from "lucide-react";
import { Tag, Flame } from "lucide-react";
import { getCategoriesAsync, getAllPostsAsync, getTopTags } from "@/lib/posts";
import { getAuthor } from "@/lib/config";
import { formatDate } from "@/lib/i18n/format";
import { tagSlug } from "@/lib/tag-utils";
import { getArchiveTree } from "@/lib/archive";
import { LocalizedLink } from "@/components/LocalizedLink";
import { UserAvatar } from "./UserAvatar";
import { ArchiveWidget } from "./ArchiveWidget";
import { AuthorSocialIcons } from "./AuthorSocialIcons";
import { TrendingPosts } from "./TrendingPosts";
import { SectionIcon } from "./SectionIcon";
import { t } from "@/lib/i18n/messages";
import { localizeCategoryName } from "@/lib/i18n/overrides";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";

/* ── Category accent colours (matches PlaceholderCover palette) ── */
const categoryColor: Record<string, string> = {
  hot: "#e11d48",
  bodhu: "#db2777",
  tarona: "#9333ea",
  obibahito: "#35a99a",
  bibahito: "#5488dc",
  porokiya: "#be123c",
  kumari: "#fb7185",
  prem: "#e11d48",
  pesha: "#2563eb",
  paribarik: "#368fa8",
  somokami: "#a21caf",
  aloukik: "#7c3aed",
};

export async function Sidebar({
  locale = DEFAULT_LOCALE,
  authorId,
  authorName,
  authorImage,
  authorBio,
  authorVerified,
  authorUsername,
}: {
  locale?: Locale;
  authorId?: string;
  authorName?: string;
  authorImage?: string;
  authorBio?: string;
  authorVerified?: boolean;
  /**
   * The author's canonical `username` slug. The author link must point at
   * the username form — the relational-DB-id form 308-redirects there, and
   * an internal link to a redirecting URL spends crawl budget for nothing.
   */
  authorUsername?: string | null;
}) {
  const categories = await getCategoriesAsync();
  const featuredTags = await getTopTags(5);
  const allPosts = await getAllPostsAsync();
  const latestPosts = allPosts.slice(0, 5);
  let author = authorId ? getAuthor(authorId) : null;
  let authorVerifiedState = authorVerified || false;

  // Use the already-resolved post author info when available (avoids a
  // separate DB lookup that can fail due to .or() query edge cases).
  if (authorId && authorName) {
    author = {
      ...(author || {}),
      id: authorUsername || authorId,
      name: authorName,
      image: authorImage || author?.image || "",
      bio: authorBio || author?.bio || "",
      facebook: (author as any)?.facebook || "",
      website: (author as any)?.website || "",
    } as any;
    authorVerifiedState = authorVerified || false;
  } else if (authorId && author && (author.name === authorId || author.id.startsWith("usr_") || author.id.length > 20)) {
    try {
      const { getSupabaseAdmin } = await import("@/lib/supabase");
      const supabase = getSupabaseAdmin();
      const { data: dbUser } = await supabase
        .from("users")
        .select("id, username, name, profile_pic, bio, website, facebook, is_verified")
        .or(`id.eq.${authorId},username.eq.${authorId}`)
        .maybeSingle();

      if (dbUser) {
        authorVerifiedState = dbUser.is_verified === true;
        author = {
          ...(author || {}),
          id: dbUser.username || dbUser.id,
          name: dbUser.name || dbUser.username || "অজ্ঞাত লেখক",
          image: dbUser.profile_pic || "",
          bio: dbUser.bio || "",
          facebook: dbUser.facebook || "",
          website: dbUser.website || "",
        } as any;
      }
    } catch (e) {}
  }

  const archiveTree = getArchiveTree();

  return (
    <aside className="hidden overflow-visible lg:block">
      <div className="max-h-none space-y-8 overflow-visible">
        {/* Author (article pages only) — bordered card */}
        {author && (
          <section>
            <h2 className="sidebar-title">{t(locale, "sidebar.author")}</h2>
            <div className="block rounded-xl border border-border bg-surface p-4 space-y-3 shadow-sm hover:bg-surface-hover transition-colors group">
              <LocalizedLink href={`/authors/${author.id}`} className="flex items-center gap-3">
                <UserAvatar src={author.image} name={author.name} userId={author.id} size="lg" className="ring-2 ring-border/50 group-hover:ring-fg/30 transition-all" />
                <div>
                  <p className="text-sm font-medium text-fg group-hover:text-fg-muted transition-colors flex items-center gap-1">
                    {author.name}
                    {authorVerifiedState && <BadgeCheck className="w-3.5 h-3.5 text-blue-500 fill-blue-500/20 shrink-0" />}
                  </p>
                  {author.bio && (
                    <p className="text-xs text-fg-muted leading-relaxed mt-0.5">
                      {author.bio}
                    </p>
                  )}
                </div>
              </LocalizedLink>
              {/* Social links */}
              <AuthorSocialIcons
                website={author.website}
                facebook={author.facebook}
              />
            </div>
          </section>
        )}

        {/* Trending Posts */}
        <section className="sidebar-section">
          <h2 className="sidebar-title flex items-center gap-1.5">
            <Flame className="w-4 h-4 text-red-500" />
            {t(locale, "sidebar.trending")}
          </h2>
          <TrendingPosts locale={locale} />
        </section>

        {/* Categories — rounded cards with colour dots and icons.

            Categories with zero stories are skipped. Their listing page is
            a soft 404 (HTTP 200 with an empty grid) and is marked
            `noindex, follow`, so linking to it would point Google at a
            page we are simultaneously asking it not to index. */}
        {categories.length > 0 && (
          <section className="sidebar-section">
            <h2 className="sidebar-title">{t(locale, "sidebar.categories")}</h2>
            <div className="flex flex-col gap-1.5">
              {categories
                .filter((cat) => cat.count > 0)
                .map((cat) => {
                const accent = categoryColor[cat.slug] || "var(--color-fg)";
                return (
                  <LocalizedLink
                    key={cat.slug}
                    href={`/categories/${cat.slug}`}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-fg-muted hover:text-fg hover:bg-surface-hover transition-all duration-200"
                  >
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: `${accent}14`, color: accent }}
                    >
                      <SectionIcon seed={cat.slug} className="h-8 w-8 shrink-0" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-fg">
                        {localizeCategoryName(cat.slug, cat.name, locale)}
                      </p>
                    </div>
                    <span className="text-xs text-fg-subtle bg-surface-alt rounded-full px-2 py-0.5 border border-border/50">
                      {cat.count}
                    </span>
                  </LocalizedLink>
                );
                })}
            </div>
          </section>
        )}

        {/* Featured Tags (top 5 by usage) */}
        {featuredTags.length > 0 && (
          <section className="sidebar-section">
            <h2 className="sidebar-title">{t(locale, "sidebar.tags")}</h2>
            <div className="flex flex-wrap gap-1.5">
              {featuredTags.map((t) => (
                <LocalizedLink
                  key={t.tag}
                  href={`/tags/${tagSlug(t.tag)}`}
                  className="tag-cloud"
                >
                  <Tag className="h-3 w-3" />
                  {t.tag}
                  <span className="text-[10px] opacity-60">({t.count})</span>
                </LocalizedLink>
              ))}
            </div>
          </section>
        )}

        {/* Latest Posts with dividers */}
        {latestPosts.length > 0 && (
          <section className="sidebar-section">
            <h2 className="sidebar-title">
              {locale === "en" ? "Latest" : "সর্বশেষ"}
            </h2>
            <div className="divide-y divide-border/60 rounded-xl border border-border bg-surface shadow-sm">
              {latestPosts.map((post) => (
                <LocalizedLink
                  key={post.uid || post.slug}
                  href={`/${post.uid || post.slug}`}
                  className="group block px-4 py-3 first:rounded-t-xl last:rounded-b-xl hover:bg-surface-hover transition-colors"
                >
                  <p className="text-sm font-medium text-fg group-hover:text-fg transition-colors leading-snug">
                    {post.title}
                  </p>
                  <p className="text-xs text-fg-subtle mt-1.5">
                    {formatDate(post.publishedAt, locale)}
                  </p>
                </LocalizedLink>
              ))}
            </div>
          </section>
        )}

        {/* Archive by year/month */}
        <ArchiveWidget tree={archiveTree} locale={locale} />
      </div>
    </aside>
  );
}
