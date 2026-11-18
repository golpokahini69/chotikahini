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

/**
 * Render story pages ON DEMAND, not at build time.
 *
 * ── Why (Vercel ISR-write budget) ──────────────────────────────────────
 * A page prerendered at build time carries the data tags collected during
 * that render — every story page picked up `posts` from the shared story
 * list. `invalidateTags(posts)` on each publish therefore expired ALL
 * ~300 prerendered story pages at once, and every later visit to one of
 * them paid a fresh render + ISR WRITE. Vercel Hobby caps ISR writes at
 * 200K/30 days and the dashboard showed 169K used — this was the biggest
 * remaining driver of that number.
 *
 * Returning `[]` (the same pattern already used by `/golpo/[slug]`) keeps
 * ISR enabled (the route still registers in the prerender manifest) but
 * renders each page on first request and caches the result. Runtime
 * entries carry only their implicit path tags, so a publish expires the
 * DATA cache (new stories appear on the homepage at once) and exactly the
 * ONE story page we explicitly `revalidatePath` — not the whole catalogue.
 *
 * Cost: the very first hit on a cold story page renders on demand. Every
 * later hit is a cache read, same as before.
 */
export function generateStaticParams(): { slug: string }[] {
  return [];
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
