import type { Metadata } from "next";
import {
  getStoryDataByPublicSlug,
  storyJsonLd,
  storyMetadataByPublicSlug,
} from "@/lib/routes/story";
import { StoryView } from "@/components/pages/StoryView";
import { getAllPostsAsync } from "@/lib/posts";
import { getPartIndexes } from "@/lib/series-utils";

/**
 * Bangla story page — `/golpo/:slug`.
 *
 * The new, human-readable story URL. The `:slug` here is the *public slug*
 * (the title in kebab-case), not the internal uid/slug.
 *
 * ISR: story pages are cached; invalidated instantly on publish/unpublish/
 * delete via `/api/admin/posts/manage`.
 */
export const revalidate = 86400;
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return storyMetadataByPublicSlug("bn", slug);
}

/**
 * The part number for a story, when several stories share its headline.
 *
 * See `buildPartIndexes` in lib/series-utils.ts.
 */
async function getPartIndex(
  publicSlug: string,
): Promise<number | undefined> {
  try {
    const posts = await getAllPostsAsync({
      includeFuture: true,
      includePending: true,
    });
    const post = posts.find((p) => p.publicSlug === publicSlug);
    if (!post) return undefined;
    const partIndexes = getPartIndexes(posts);
    return partIndexes.get(post.uid || post.slug) ?? partIndexes.get(post.slug);
  } catch {
    return undefined;
  }
}

export default async function GolpoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getStoryDataByPublicSlug(slug);
  const jsonLd = await storyJsonLd("bn", data.post, data.site);
  const partIndex = await getPartIndex(slug);
  return (
    <StoryView locale="bn" {...data} jsonLd={jsonLd} partIndex={partIndex} />
  );
}
