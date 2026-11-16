import type { Metadata } from "next";
import { getPostsByCategoryAsync, getAllPostsAsync, type PostMeta } from "@/lib/posts";
import { getAllCategoryConfigs, getSiteConfig, type Category } from "@/lib/config";
import { buildListingMetadata } from "@/lib/metadata";
import { localizeCategoryName } from "@/lib/i18n/overrides";
import type { Locale } from "@/lib/i18n/locale";

export interface CategoryData {
  category: Category | undefined;
  allCategories: Category[];
  posts: PostMeta[];
  /** Published-story count per category id. */
  categoryCounts: Map<string, number>;
}

/** Data for a category listing. */
export async function getCategoryData(
  categoryId: string,
): Promise<CategoryData> {
  const allPosts = await getAllPostsAsync();
  const posts = allPosts.filter((p) => p.categoryId === categoryId);
  const allCategories = getAllCategoryConfigs();
  const category = allCategories.find((c) => c.id === categoryId);

  // Counts for every sibling category, so the view can skip the ones that
  // have no stories (their pages are `noindex` soft 404s).
  const categoryCounts = new Map<string, number>();
  for (const p of allPosts) {
    const id = (p.categoryId || "").trim();
    if (id) categoryCounts.set(id, (categoryCounts.get(id) || 0) + 1);
  }
  for (const c of allCategories) {
    if (!categoryCounts.has(c.id)) categoryCounts.set(c.id, 0);
  }

  return { category, allCategories, posts, categoryCounts };
}

/** The category ids to pre-render. */
export function getCategoryParams(): { category: string }[] {
  return getAllCategoryConfigs().map((cat) => ({ category: cat.id }));
}

/**
 * Metadata for a category listing.
 *
 * A category with no published stories is a *soft 404*: it answers 200 with
 * an empty grid, which Google indexes as a thin page rather than dropping.
 * Such a page is marked `noindex, follow` so it can still pass link equity
 * to the sibling categories but is not offered to the index.
 *
 * The check needs the post list, so this is async — `generateMetadata` in
 * the route awaits it.
 */
export async function categoryMetadata(
  locale: Locale,
  categoryId: string,
): Promise<Metadata> {
  const cat = getAllCategoryConfigs().find((c) => c.id === categoryId);
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  const name = localizeCategoryName(cat?.id || categoryId, cat?.name, locale);
  const description =
    cat?.description ||
    (locale === "en"
      ? `All stories in ${name}`
      : `${name} বিভাগের সকল লেখা`);
  const path = `/categories/${categoryId}`;

  let postCount = 0;
  try {
    const posts = await getPostsByCategoryAsync(categoryId);
    postCount = posts.length;
  } catch {
    // If the count cannot be determined we keep the page indexable — the
    // listing itself renders the same data and would 404 if it were empty.
    postCount = -1;
  }

  const metadata = buildListingMetadata(
    name,
    description,
    locale === "en" ? `${base}/en${path}` : `${base}${path}`,
    categoryId,
    locale,
  );

  if (postCount === 0) {
    return {
      ...metadata,
      robots: { index: false, follow: true },
    };
  }

  return metadata;
}
