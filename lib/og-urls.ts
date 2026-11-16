import { getSiteConfig } from "@/lib/config";
import type { SiteConfig } from "@/lib/config";
import type { PostMeta } from "./posts";

/**
 * Bumped whenever the share-card renderer changes.
 *
 * This is the CDN cache-busting mechanism: Vercel caches by full URL, so
 * a new `?v=` produces a new cache key and evicts the previously-cached
 * card. It is also part of the in-process cache fingerprint, so a render
 * change produces new bytes rather than a stale L1 hit.
 *
 * v6 — the cards were rebuilt without the story cover photograph. The old
 * cards embedded explicit imagery and were suppressed by the social
 * platforms' adult-content classifiers.
 *
 * v7 — videos and picture galleries got their own cards, built from their
 * own cover blurred past recognition, and every card's title stopped being
 * cut mid-sentence.
 *
 * v8 — the cover blur was softened to 10% of the frame width, so the media's
 * own artwork is recognisable behind the title, with a heavy scrim over it.
 * The card bytes changed, so the version had to change with them.
 *
 * v9 — every card now carries a type badge (STORY / VIDEO / PICTURE) and a
 * kind-tinted background, so the content type is readable at a glance in a
 * Twitter/X timeline, where the badge is often rendered small.
 *
 * v10 — the story card finally uses the story's own cover as its
 * background, like the video and picture cards already did. The cover is
 * blurred past recognition and laid under a scrim, so it reads as the
 * story's artwork behind the title without exposing the image.
 *
 * v11 — the cover blur is back up to the 10% of the frame width that v8
 * intended (a sigma of 120, not the 18 it had drifted down to). At sigma 18
 * the cover was still plainly legible — a face, an arm, the shape of a torso
 * — which is exactly the silhouette a platform's adult-content classifier
 * reads. The scrim was lightened to match, so the cover's own colour still
 * reads as the card's background rather than being flattened into a generic
 * dark gradient.
 *
 * v12 — the cover blur came back down, a long way: to 1.25% of the frame
 * width (a sigma of 15), with the scrim lightened to match. At sigma 120 the
 * card was an unreadable colour wash and the reader could not tell what the
 * story looked like. The blur and the scrim are now tunable in one place
 * (`lib/og-cover-background.ts`) and overridable at runtime with
 * `OG_COVER_BLUR` / `OG_COVER_SCRIM`, so the card can be dialled in or out
 * without a code change.
 *
 * Note the risk this version takes on: a light blur puts the cover back in
 * front of the classifiers that v11 was written to stay ahead of. If cards
 * start coming back suppressed, raising `DEFAULT_BLUR_RATIO` and bumping
 * this version again is the whole fix.
 */
export const OG_IMAGE_VERSION = 12;

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * The cache-busting fingerprint for the homepage share card.
 *
 * The OG route uses this for its in-process cache key as well, so both
 * sides agree on when the rendered bytes change.
 */
export function siteOgVersion(siteConfig: SiteConfig = getSiteConfig()): string {
  return fingerprint(
    `${OG_IMAGE_VERSION}\n${process.env.VERCEL_GIT_COMMIT_SHA || ""}\n${siteConfig.url}\n${siteConfig.title}\n${siteConfig.tagline}`,
  );
}

/**
 * The cache-busting fingerprint for a story's share card.
 *
 * `OG_IMAGE_VERSION` is part of the fingerprint so that a change to the
 * card renderer invalidates every card at once.
 */
export function postOgVersion(post: PostMeta): string {
  return fingerprint(
    `${OG_IMAGE_VERSION}\n${post.updatedAt || ""}\n${post.publishedAt || ""}\n${post.title || ""}`,
  );
}

export function toSiteOgUrl(siteConfig: SiteConfig = getSiteConfig()): string {
  const base = siteConfig.url.endsWith("/") ? siteConfig.url.slice(0, -1) : siteConfig.url;
  return `${base}/api/og/home?v=${siteOgVersion(siteConfig)}`;
}

/**
 * Build the per-post social-share preview URL.
 *
 * Each story gets its own composed OpenGraph card served by
 * `/api/og/post/[identifier]` — an abstract branded background with the
 * title, author, category, and age badge overlaid, sized 1200×630.
 * Returns the absolute URL (with site origin) so it can be dropped
 * straight into `openGraph.images[].url`.
 *
 * The cache-busting `v=` value is a short hash of the post's timestamps
 * rather than the raw ISO timestamp. The timestamp encoded to
 * `2026-11-04T20%3A02%3A37.16%2B00%3A00` — a query string full of
 * percent-encoded colons and plus signs. Twitter's crawler is strict
 * about what it accepts in `og:image` and a malformed URL there causes
 * the card to render without a picture. A hex hash is safe in every
 * position of a URL.
 */
export function toPostOgUrl(post: PostMeta, siteConfig?: ReturnType<typeof getSiteConfig>): string {
  const site = siteConfig || getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  const identifier = post.uid || post.slug;
  return `${base}/api/og/post/${encodeURIComponent(identifier)}?v=${postOgVersion(post)}`;
}

/**
 * The two kinds of media that get their own share card.
 *
 * They share one route and one renderer — the cards differ only in
 * which table they read from and what they call the byline.
 */
export type OgMediaKind = "video" | "picture";

/**
 * The cache-busting fingerprint for a video or picture share card.
 *
 * Same shape as `postOgVersion`: `OG_IMAGE_VERSION` is part of the
 * fingerprint so that a change to the card renderer invalidates every
 * card at once, and the row's `updated_at` is part of it so that
 * editing a title or swapping a cover produces a new card rather than
 * stale bytes.
 */
export function mediaOgVersion(
  kind: OgMediaKind,
  id: string,
  updatedAt?: string | null,
): string {
  return fingerprint(
    `${OG_IMAGE_VERSION}\n${kind}\n${id}\n${updatedAt || ""}`,
  );
}

/**
 * Build the share-preview URL for a video or a picture gallery.
 *
 * Both point at `/api/og/media/[kind]/[id]`, which composites the
 * media's own cover behind its title. The `v=` value is a short hex
 * hash rather than a timestamp — a raw ISO timestamp would put
 * percent-encoded colons and plus signs into the query string, and
 * Twitter's crawler is strict about what it accepts in `og:image`.
 */
export function toMediaOgUrl(
  kind: OgMediaKind,
  id: string,
  updatedAt?: string | null,
  siteConfig?: ReturnType<typeof getSiteConfig>,
): string {
  const site = siteConfig || getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  return `${base}/api/og/media/${kind}/${encodeURIComponent(id)}?v=${mediaOgVersion(
    kind,
    id,
    updatedAt,
  )}`;
}
