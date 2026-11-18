import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PictureListShell } from "@/components/PictureListShell";
import { isPictureSectionEnabled } from "@/lib/config";
import {
  pictureTagFromSlug,
  pictureTagSlug,
} from "@/lib/picture-tag-utils";
import { buildListingMetadata } from "@/lib/metadata";
import { getSiteConfig } from "@/lib/config";

interface Props {
  params: Promise<{ tag: string }>;
}

// ISR budget: was 3600s. Vercel Hobby caps ISR writes at
// 200K/30d and this route was regenerating far too often. Publishes purge
// these paths on demand (revalidatePath), so the timer is only a fallback.
export const revalidate = 21600;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!isPictureSectionEnabled()) {
    return { title: "ছবি পাওয়া যায়নি", robots: "noindex, nofollow" };
  }

  const { tag: tagSlugParam } = await params;
  const tag = pictureTagFromSlug(tagSlugParam);
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;

  return buildListingMetadata(
    `#${tag}`,
    `"${tag}" ট্যাগযুক্ত সব ছবির গ্যালেরি — প্রতিটি সিরিজের সব ছবি একসাথে`,
    `${base}/pictures/tag/${tagSlugParam}`,
  );
}

/**
 * Pictures filtered by one tag.
 *
 * The slug in the URL is decoded back to the tag name, which is then used
 * as the filter value. The comparison itself is case-insensitive (see
 * scripts/picture-tags.sql), so a gallery tagged "blonde" is found by the
 * link "Blonde".
 */
export default async function PictureTagPage({ params }: Props) {
  if (!isPictureSectionEnabled()) notFound();

  const { tag: tagSlugParam } = await params;
  const tag = pictureTagFromSlug(tagSlugParam);
  if (!tag) notFound();

  return (
    <PictureListShell
      title={`#${tag}`}
      subtitle={`"${tag}" ট্যাগযুক্ত সব ছবির গ্যালেরি।`}
      currentPage={1}
      activeTag={tag}
      paginationBase={`/pictures/tag/${pictureTagSlug(tag)}/page`}
    />
  );
}
