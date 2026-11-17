import { notFound } from "next/navigation";
import { PictureListShell } from "@/components/PictureListShell";
import { isPictureSectionEnabled } from "@/lib/config";
import {
  pictureTagFromSlug,
  pictureTagSlug,
} from "@/lib/picture-tag-utils";

interface Props {
  params: Promise<{ category: string; num: string }>;
}

export const revalidate = 3600;

/**
 * Empty by design — it is what registers this route for ISR.
 *
 * With `revalidate` but NO `generateStaticParams`, Next 16 leaves the route
 * out of the prerender manifest's `dynamicRoutes`, silently ignoring the
 * revalidate above: every request paid a full server render plus fresh
 * database reads, and the build shipped it as plain `ƒ (Dynamic)` (verified
 * in production: `x-vercel-cache: MISS` + `private, no-store`).
 *
 * `[]` means "prerender nothing, render on demand" — the on-demand render is
 * then CACHED and reused for `revalidate` seconds instead. Unknown params
 * still render because Next defaults `dynamicParams` to true.
 */
export function generateStaticParams(): { num: string }[] {
  return [];
}

/**
 * Page 2+ of a category-filtered gallery list.
 *
 * The category stays in the URL on every page, so the filter survives
 * pagination and each page has its own indexable URL.
 */
export default async function PictureCategoryPagedPage({ params }: Props) {
  if (!isPictureSectionEnabled()) notFound();

  const { category: categorySlug, num } = await params;
  const page = Number(num);
  if (!Number.isFinite(page) || page < 2) notFound();

  const category = pictureTagFromSlug(categorySlug);
  if (!category) notFound();

  return (
    <PictureListShell
      title={category}
      subtitle={`"${category}" ক্যাটাগরির সব ছবির গ্যালেরি।`}
      currentPage={page}
      activeCategory={category}
      paginationBase={`/pictures/category/${pictureTagSlug(category)}/page`}
    />
  );
}
