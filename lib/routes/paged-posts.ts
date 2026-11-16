import type { Metadata } from "next";
import { getAllPostsAsync, type PostMeta } from "@/lib/posts";
import { POSTS_PER_PAGE } from "@/lib/constants";
import { buildPagedMetadata } from "@/lib/metadata";
import { getSiteConfig } from "@/lib/config";
import type { Locale } from "@/lib/i18n/locale";

export interface PagedPostsData {
  pageNum: number;
  totalPages: number;
  posts: PostMeta[];
}

/**
 * Data + metadata for the paginated story listing.
 *
 * Shared by the paginated story listing and its metadata builder.
 */
export async function getPagedPostsData(
  num: string,
): Promise<PagedPostsData> {
  const pageNum = parseInt(num, 10);
  const allPosts = await getAllPostsAsync();
  const totalPages = Math.ceil(allPosts.length / POSTS_PER_PAGE);
  const start = (pageNum - 1) * POSTS_PER_PAGE;
  const posts = allPosts.slice(start, start + POSTS_PER_PAGE);

  return { pageNum, totalPages, posts };
}

/**
 * Whether the requested page number actually exists.
 *
 * `getPagedPostsData` happily returns an empty `posts` array for any number
 * at or past the end of the archive, and `parseInt` returns NaN for a
 * non-numeric segment. Both used to render a "nothing here" page with a
 * 200 status, which is a soft 404 — Google sees an indexable, empty page
 * at every /page/<garbage> URL.
 */
export function isValidPagedPostsNum(
  num: string,
  totalPages: number,
): boolean {
  const pageNum = parseInt(num, 10);
  if (!Number.isFinite(pageNum)) return false;
  // Page 1 is the homepage, so the paginated route starts at 2.
  if (pageNum < 2) return false;
  if (pageNum > totalPages) return false;
  return true;
}

export function pagedPostsMetadata(locale: Locale, num: string): Metadata {
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  const pageNum = parseInt(num, 10);
  const path = `/page/${num}`;

  return buildPagedMetadata(
    site.title,
    site.seo?.description || site.description,
    locale === "en" ? `${base}/en${path}` : `${base}${path}`,
    pageNum,
    locale,
  );
}

/** The set of page numbers to pre-render (page 1 is the homepage). */
export async function getPagedPostsParams(): Promise<{ num: string }[]> {
  const total = (await getAllPostsAsync()).length;
  const pages = Math.ceil(total / POSTS_PER_PAGE);
  return Array.from({ length: pages - 1 }, (_, i) => ({ num: String(i + 2) }));
}
