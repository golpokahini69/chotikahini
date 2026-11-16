import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import {
  getStoryData,
  getStoryParams,
  resolveLegacyStoryPath,
  storyJsonLd,
  storyMetadata,
} from "@/lib/routes/story";
import { StoryView } from "@/components/pages/StoryView";
import { getAllPostsAsync } from "@/lib/posts";
import { getPartIndexes } from "@/lib/series-utils";

/**
 * Bangla story page — `/:slug`.
 *
 * ISR: story pages are cached; invalidated instantly on publish/unpublish/
 * delete via `/api/admin/posts/manage`.
 */
export const revalidate = 86400;
export const dynamicParams = true;

export async function generateStaticParams() {
  return getStoryParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return storyMetadata("bn", slug);
}

/**
 * The part number for a story, when several stories share its headline.
 *
 * See `buildPartIndexes` in lib/series-utils.ts.
 *
 * Uses the same memoised post list/indexes as the story loader, so this is
 * an in-memory lookup rather than a second full pass over every story.
 */
async function getPartIndex(
  slug: string,
): Promise<number | undefined> {
  try {
    const posts = await getAllPostsAsync({
      includeFuture: true,
      includePending: true,
    });
    const post = posts.find(
      (p) => p.slug === slug || p.uid === slug || p.fileSlug === slug,
    );
    if (!post) return undefined;
    const partIndexes = getPartIndexes(posts);
    return partIndexes.get(post.uid || post.slug) ?? partIndexes.get(post.slug);
  } catch {
    return undefined;
  }
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Legacy URL → new public URL.
  //
  // Stories published after the public-slug rollout have a `public_slug`,
  // and their canonical address is now `/golpo/<public_slug>`. This route
  // still resolves them (and every pre-rollout story that has no slug), so
  // we 308 to the new address when one exists.
  //
  // The redirect is resolved *before* the story is loaded, so the redirect
  // response never depends on whether the story is published, cached, or
  // still pending review.
  const legacyPath = await resolveLegacyStoryPath(slug);
  if (legacyPath) permanentRedirect(legacyPath);

  const data = await getStoryData(slug);
  const jsonLd = await storyJsonLd("bn", data.post, data.site);
  const partIndex = await getPartIndex(slug);
  return <StoryView locale="bn" {...data} jsonLd={jsonLd} partIndex={partIndex} />;
}
