import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PictureListShell } from "@/components/PictureListShell";
import { isPictureSectionEnabled, getSiteConfig } from "@/lib/config";
import {
  pictureTagFromSlug,
  pictureTagSlug,
} from "@/lib/picture-tag-utils";
import { buildListingMetadata } from "@/lib/metadata";

interface Props {
  params: Promise<{ category: string }>;
}

// ISR budget: was 3600s. Vercel Hobby caps ISR writes at
// 200K/30d and this route was regenerating far too often. Publishes purge
// these paths on demand (revalidatePath), so the timer is only a fallback.
export const revalidate = 21600;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: Props): Promise<Metadata> {
  if (!isPictureSectionEnabled()) {
    return { title: "ছবি পাওয়া যায়নি", robots: "noindex, nofollow" };
  }

  const { category: categorySlug } = await params;
  const category = pictureTagFromSlug(categorySlug);
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;

  return buildListingMetadata(
    `${category}`,
    `"${category}" ক্যাটাগরির সব ছবির গ্যালেরি — প্রতিটি সিরিজের সব ছবি একসাথে`,
    `${base}/pictures/category/${categorySlug}`,
  );
}

/**
 * Pictures filtered by one category.
 *
 * Categories come from the provider's own category list (PornPics calls
 * them "Categories", the other providers use a similar concept), so they
 * are filtered the same way tags are — case-insensitively.
 */
export default async function PictureCategoryPage({ params }: Props) {
  if (!isPictureSectionEnabled()) notFound();

  const { category: categorySlug } = await params;
  const category = pictureTagFromSlug(categorySlug);
  if (!category) notFound();

  return (
    <PictureListShell
      title={category}
      subtitle={`"${category}" ক্যাটাগরির সব ছবির গ্যালেরি।`}
      currentPage={1}
      activeCategory={category}
      paginationBase={`/pictures/category/${pictureTagSlug(category)}/page`}
    />
  );
}
