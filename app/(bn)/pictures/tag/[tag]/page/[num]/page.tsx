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

export const revalidate = 3600;

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
