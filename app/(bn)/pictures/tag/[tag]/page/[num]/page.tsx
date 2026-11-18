import { notFound } from "next/navigation";
import { PictureListShell } from "@/components/PictureListShell";
import { isPictureSectionEnabled } from "@/lib/config";
import {
  pictureTagFromSlug,
  pictureTagSlug,
} from "@/lib/picture-tag-utils";

interface Props {
  params: Promise<{ tag: string; num: string }>;
}

// ISR budget: was 3600s. Vercel Hobby caps ISR writes at
// 200K/30d and this route was regenerating far too often. Publishes purge
// these paths on demand (revalidatePath), so the timer is only a fallback.
export const revalidate = 21600;

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
 * Page 2+ of a tag-filtered gallery list.
 *
 * The tag stays in the URL on every page, so the filter survives
 * pagination and each page has its own indexable URL.
 */
export default async function PictureTagPagedPage({ params }: Props) {
  if (!isPictureSectionEnabled()) notFound();

  const { tag: tagSlugParam, num } = await params;
  const page = Number(num);
  if (!Number.isFinite(page) || page < 2) notFound();

  const tag = pictureTagFromSlug(tagSlugParam);
  if (!tag) notFound();

  return (
    <PictureListShell
      title={`#${tag}`}
      subtitle={`"${tag}" ট্যাগযুক্ত সব ছবির গ্যালেরি।`}
      currentPage={page}
      activeTag={tag}
      paginationBase={`/pictures/tag/${pictureTagSlug(tag)}/page`}
    />
  );
}
