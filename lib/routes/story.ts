import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getAllPostsAsync,
  getPostBySlugAsync,
  getPostByPublicSlugAsync,
  getRelatedPosts,
  getSeries,
  type Post,
} from "@/lib/posts";
import { getSiteConfig, getAuthor, type SiteConfig, type Author } from "@/lib/config";
import {
  generatePostMetadata,
  generatePostJsonLd,
  type JsonLdGraph,
} from "@/lib/seo";
import { getSession } from "@/lib/auth";
import { getPartIndexes, buildSeriesLookup, getSeriesId, getSeriesTitle } from "@/lib/series-utils";
import { isAtLeast, hasPermission } from "@/lib/permissions";
import { t } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/locale";

/**
 * Slugs that are reserved by real routes and must never be shadowed by the
 * catch-all `[slug]` route.
 *
 * `en` is reserved because the English site lives at `/en` — without this,
 * a story whose slug is literally "en" would be unreachable.
 */
const RESERVED_SLUGS = new Set([
  "about",
  "api",
  "atom.xml",
  "authors",
  "categories",
  "chat",
  "contact",
  "en",
  "feed",
  "feed.xml",
  "featured",
  "golpo",
  "image",
  "index.xml",
  "page",
  "pictures",
  "posts",
  "privacy",
  "read",
  "rss",
  "rss.xml",
  "rss-pictures.xml",
  "search",
  "series",
  "sitemap",
  "tags",
  "not-found",
  "video",
  "videos",
]);

export interface StoryData {
  post: Post;
  site: SiteConfig;
  authorMeta: Author | undefined;
  jsonLd: JsonLdGraph;
  related: Post[];
  isPendingPreview: boolean;
  /**
   * The series this story belongs to, when it is part of one.
   *
   * Rendered as a link back to the series page. Without it the series
   * detail page is only reachable from the /series index — and only after
   * a reader expands that story's accordion panel, which never happens in
   * the server-rendered HTML the crawler sees.
   */
  series?: { id: string; title: string } | null;
}

/**
 * Resolve a legacy URL segment to a story's canonical public path.
 *
 * Returns null when the segment is not a legacy story URL, or when the
 * story has no `public_slug` yet (in which case its `/{uid}` URL *is*
 * the canonical one and must keep rendering).
 *
 * "Legacy" means the URL segment is one of the story's identity fields —
 * `uid`, `slug` or `fileSlug` — and not its title. `getPostBySlugAsync`
 * also matches on the title, so a path like `/my-story-headline` would
 * otherwise resolve to a story and get hijacked into a redirect. Real
 * routes (`/about`, `/golpo`, …) are protected by the same rule.
 */
export async function resolveLegacyStoryPath(
  segment: string,
): Promise<string | null> {
  const q = (segment || "").replace(/^\//, "").replace(/\.mdx$/i, "").toLowerCase().trim();
  if (!q) return null;

  let post: Post | null = null;
  try {
    post = await getPostBySlugAsync(q);
  } catch {
    return null;
  }
  if (!post) return null;

  // No public slug → the old URL is still the canonical address.
  if (!post.publicSlug) return null;

  const isIdentityMatch =
    post.uid?.toLowerCase() === q ||
    post.slug?.toLowerCase() === q ||
    post.fileSlug?.toLowerCase() === q;
  if (!isIdentityMatch) return null;

  return `/golpo/${post.publicSlug}`;
}

/**
 * Load a story for rendering, handling the unpublished/preview case.
 *
 * The session is only read when a story is unpublished — reading a cookie
 * unconditionally would make the whole route dynamic and kill ISR.
 */
export async function getStoryData(slug: string): Promise<StoryData> {
  let post: Post | null = null;
  try {
    post = await getPostBySlugAsync(slug);
  } catch {
    post = null;
  }
  if (!post) notFound();

  const isPublished =
    post.status === "published" &&
    new Date(post.publishedAt).getTime() <= Date.now();
  let isPendingPreview = false;

  if (!isPublished) {
    const session = await getSession();
    const isAuthor =
      !!session && (session.id === post.authorId || session.username === post.authorId);
    const isAdmin =
      !!session &&
      (isAtLeast(session.role, "moderator") ||
        hasPermission(session.role, "story.review"));

    if (!isAuthor && !isAdmin) {
      notFound();
    }
    isPendingPreview = true;
  }

  const site = getSiteConfig();
  const authorMeta = getAuthor(post.authorId) ?? undefined;
  const related = getRelatedPosts(post, 4);

  // Which series does this story belong to?
  let series: { id: string; title: string } | null = null;
  try {
    const seriesList = await getSeries();
    const lookup = buildSeriesLookup(
      seriesList.map((s) => ({
        id: getSeriesId(s),
        title: getSeriesTitle(s),
        posts: s,
      })),
    );
    for (const key of [post.uid, post.slug, post.fileSlug]) {
      if (!key) continue;
      const hit = lookup.get(key.toLowerCase().trim());
      if (hit) {
        series = hit;
        break;
      }
    }
  } catch {
    series = null;
  }

  return {
    post,
    site,
    authorMeta,
    jsonLd: { "@context": "https://schema.org", "@graph": [] },
    related,
    isPendingPreview,
    series,
  };
}

/** Metadata for a story page. */
export async function storyMetadata(
  locale: Locale,
  slug: string,
): Promise<Metadata> {
  try {
    const posts = await getAllPostsAsync({
      includeFuture: true,
      includePending: true,
    });
    const post =
      posts.find(
        (p) => p.slug === slug || p.uid === slug || p.fileSlug === slug,
      ) || null;
    if (!post) return {};

    const isPublished =
      post.status === "published" &&
      new Date(post.publishedAt).getTime() <= Date.now();
    if (!isPublished) {
      // Suppress SEO & OpenGraph tags for unapproved/pending stories
      return {
        title: t(locale, "story.notFound"),
        robots: { index: false, follow: false },
      };
    }

    const site = getSiteConfig();
    // Several distinct stories on this site share an identical headline.
    // Numbering the colliding ones keeps every <title> unique so Google
    // can index each of them instead of collapsing them into one.
    const partIndexes = getPartIndexes(posts);
    const partIndex =
      partIndexes.get(post.uid || post.slug) ??
      partIndexes.get(post.slug);
    return generatePostMetadata(post, site, locale, partIndex);
  } catch {
    return {};
  }
}

/** JSON-LD for a story page. */
export async function storyJsonLd(
  locale: Locale,
  post: Post,
  site: SiteConfig,
): Promise<JsonLdGraph> {
  // Keep the structured-data headline identical to the <title>, including
  // the part number that disambiguates same-headline stories.
  let partIndex: number | undefined;
  try {
    const posts = await getAllPostsAsync({
      includeFuture: true,
      includePending: true,
    });
    const partIndexes = getPartIndexes(posts);
    partIndex =
      partIndexes.get(post.uid || post.slug) ?? partIndexes.get(post.slug);
  } catch {
    partIndex = undefined;
  }
  return generatePostJsonLd(post, site, undefined, locale, partIndex);
}

/** The slugs to pre-render for the story route. */
export async function getStoryParams(): Promise<{ slug: string }[]> {
  try {
    const posts = await getAllPostsAsync();
    return posts
      .filter((p) => !RESERVED_SLUGS.has(p.slug))
      .map((post) => ({ slug: post.slug }));
  } catch {
    return [];
  }
}


/**
 * Load a story by its public slug (/golpo/<slug>).
 *
 * The public slug is the title in kebab-case, so it can't be fed to
 * `getPostBySlugAsync` — that resolves by uid/slug/fileSlug/title, not by
 * the `public_slug` column.
 */
export async function getStoryDataByPublicSlug(
  publicSlug: string,
): Promise<StoryData> {
  let post: Post | null = null;
  try {
    post = await getPostByPublicSlugAsync(publicSlug);
  } catch {
    post = null;
  }
  if (!post) notFound();

  const isPublished =
    post.status === "published" &&
    new Date(post.publishedAt).getTime() <= Date.now();
  let isPendingPreview = false;

  if (!isPublished) {
    const session = await getSession();
    const isAuthor =
      !!session && (session.id === post.authorId || session.username === post.authorId);
    const isAdmin =
      !!session &&
      (isAtLeast(session.role, "moderator") ||
        hasPermission(session.role, "story.review"));

    if (!isAuthor && !isAdmin) {
      notFound();
    }
    isPendingPreview = true;
  }

  const site = getSiteConfig();
  const authorMeta = getAuthor(post.authorId) ?? undefined;
  const related = getRelatedPosts(post, 4);

  // Which series does this story belong to?
  let series: { id: string; title: string } | null = null;
  try {
    const seriesList = await getSeries();
    const lookup = buildSeriesLookup(
      seriesList.map((s) => ({
        id: getSeriesId(s),
        title: getSeriesTitle(s),
        posts: s,
      })),
    );
    for (const key of [post.uid, post.slug, post.fileSlug]) {
      if (!key) continue;
      const hit = lookup.get(key.toLowerCase().trim());
      if (hit) {
        series = hit;
        break;
      }
    }
  } catch {
    series = null;
  }

  return {
    post,
    site,
    authorMeta,
    jsonLd: { "@context": "https://schema.org", "@graph": [] },
    related,
    isPendingPreview,
    series,
  };
}

/**
 * Metadata for a story reached through its public slug.
 *
 * Mirrors `storyMetadata`, but resolves the post by `public_slug`.
 */
export async function storyMetadataByPublicSlug(
  locale: Locale,
  publicSlug: string,
): Promise<Metadata> {
  try {
    const posts = await getAllPostsAsync({
      includeFuture: true,
      includePending: true,
    });
    const post = posts.find((p) => p.publicSlug === publicSlug) || null;
    if (!post) return {};

    const isPublished =
      post.status === "published" &&
      new Date(post.publishedAt).getTime() <= Date.now();
    if (!isPublished) {
      return {
        title: t(locale, "story.notFound"),
        robots: { index: false, follow: false },
      };
    }

    const site = getSiteConfig();
    const partIndexes = getPartIndexes(posts);

    return generatePostMetadata(
      post,
      site,
      locale,
      partIndexes.get(post.uid || post.slug),
    );
  } catch (e) {
    console.error("[story] metadata generation failed:", e);
    return {};
  }
}
