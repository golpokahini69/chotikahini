type SeriesEpisode = {
  uid?: string | null;
  slug: string;
  title: string;
};

export function getSeriesTitle(series: readonly SeriesEpisode[]): string {
  const firstTitle = series[0]?.title || "";
  return firstTitle
    .replace(/\s*[-|:]?\s*(পর্ব|part|chapter|পর্বঃ)\s*[-|:]?\s*(\d+|[০-৯]+)/gi, "")
    .replace(/\s*[-|:]?\s*(\d+|[০-৯]+)\s*$/gi, "")
    .replace(/\s*\(\s*(\d+|[০-৯]+)\s*\)\s*$/gi, "")
    .trim() || firstTitle;
}

export function getSeriesId(series: readonly SeriesEpisode[]): string {
  const firstEpisode = series[0];
  const key = firstEpisode?.uid || firstEpisode?.slug || getSeriesTitle(series);
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  }
  return `s-${(hash >>> 0).toString(36)}`;
}

/**
 * Strip a trailing part number from a title ("… – ২" → "…").
 */
export function stripPartNumber(title: string): string {
  return title
    .replace(/\s*[-\|:]?\s*(পর্ব|part|chapter|পর্বঃ)\s*[-\|:]?\s*(\d+|[০-৯]+)/gi, "")
    .replace(/\s*[-\|:]?\s*(\d+|[০-৯]+)\s*$/gi, "")
    .replace(/\s*\(\s*(\d+|[০-৯]+)\s*\)\s*$/gi, "")
    .trim();
}

/**
 * Build a lookup from a story key (uid or slug) to the series it belongs to.
 *
 * A story page needs a link back to its series page. Without it the series
 * detail page is reachable only from the /series index — and only after
 * the reader expands that story's accordion panel, which happens in the
 * browser, not in the server-rendered HTML. A series that is linked from
 * nowhere in the initial HTML is effectively an orphan.
 *
 * The key is matched case-insensitively against the story's uid, slug and
 * fileSlug, matching how `getSeries()` groups the stories in the first
 * place.
 */
export function buildSeriesLookup(
  seriesList: readonly { id: string; title: string; posts: readonly { uid?: string | null; slug?: string; fileSlug?: string }[] }[],
): Map<string, { id: string; title: string }> {
  const lookup = new Map<string, { id: string; title: string }>();

  for (const series of seriesList) {
    for (const post of series.posts) {
      for (const key of [post.uid, post.slug, post.fileSlug]) {
        if (!key) continue;
        const normalised = key.toLowerCase().trim();
        if (!normalised || lookup.has(normalised)) continue;
        lookup.set(normalised, { id: series.id, title: series.title });
      }
    }
  }

  return lookup;
}

/**
 * Group stories by their base title and number the ones that collide.
 *
 * Several distinct stories on this site share an identical headline —
 * "ভ্রমণের ডায়েরী" and "জোড়া গুদের চাপ" each appear twice, and
 * "রিয়া কী করে বেস্যা হলো – ১" appears twice even though it already
 * carries a part number. Two pages with the same <title> are a
 * duplicate-content signal: Google indexes one and drops the other, so
 * part of the site's catalogue was invisible no matter how good the rest
 * of the SEO was.
 *
 * Numbering the colliding ones ("… — পর্ব ১", "… — পর্ব ২") makes each
 * title unique while keeping the human-readable headline intact.
 *
 * Stories whose headline is already unique inside its group are left
 * alone — a genuine series ("গল্প ১", "গল্প ২", "গল্প ৩") keeps its own
 * numbering and does not need a second one bolted on.
 *
 * The map is keyed by the story's uid/slug so the lookup is O(1) at
 * render time.
 */
export function buildPartIndexes(
  posts: readonly { uid?: string | null; slug?: string; title?: string; publishedAt?: string }[],
): Map<string, number> {
  // base title -> raw title -> stories
  const groups = new Map<string, Map<string, { post: (typeof posts)[number]; publishedAt: number }[]>>();

  for (const post of posts) {
    const title = (post.title || "").trim();
    if (!title) continue;
    const base = stripPartNumber(title).toLowerCase();
    if (!base || base.length <= 2) continue;

    if (!groups.has(base)) groups.set(base, new Map());
    const byTitle = groups.get(base)!;
    const key = title.toLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key)!.push({
      post,
      publishedAt: post.publishedAt
        ? new Date(post.publishedAt).getTime()
        : 0,
    });
  }

  const indexes = new Map<string, number>();
  for (const byTitle of groups.values()) {
    // Only a headline that appears more than once needs disambiguating.
    for (const group of byTitle.values()) {
      if (group.length < 2) continue;
      // Oldest first, so part 1 is the original publication.
      group.sort((a, b) => a.publishedAt - b.publishedAt);
      group.forEach((entry, i) => {
        const key = entry.post.uid || entry.post.slug;
        if (key) indexes.set(key, i + 1);
      });
    }
  }
  return indexes;
}

/**
 * Memoised `buildPartIndexes`.
 *
 * The input is the shared, memoised post array from `getAllPostsAsync`, so
 * its identity is stable between renders. Grouping every headline again on
 * every story page view was pointless CPU — this builds the map once per
 * dataset version.
 */
const partIndexMemo = new WeakMap<readonly unknown[], Map<string, number>>();

export function getPartIndexes(
  posts: readonly { uid?: string | null; slug?: string; title?: string; publishedAt?: string }[],
): Map<string, number> {
  const key = posts as readonly unknown[];
  const cached = partIndexMemo.get(key);
  if (cached) return cached;

  const indexes = buildPartIndexes(posts);
  partIndexMemo.set(key, indexes);
  return indexes;
}
