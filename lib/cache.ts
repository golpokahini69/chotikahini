// ─────────────────────────────────────────────────────────────
// lib/cache.ts — multi-tier read cache for DB-backed data.
//
// Goal (system design): stop every page load from hitting Supabase.
//
//   L1  in-process single-flight   plain Map; de-dupes concurrent callers of
//                                  the same key, never serves a stored value
//   L2  Next.js Data Cache         `unstable_cache`, shared across requests,
//                                  serverless instances and cold starts
//   L3  HTTP / CDN cache           `Cache-Control: s-maxage` headers on the
//                                  JSON endpoints that expose this data
//
// Properties
//   • Single-flight: N concurrent misses trigger exactly ONE query.
//   • No per-instance serving window: L1 never returns a value older than the
//     call that produced it (see DEFAULT_FRESH_MS below), so an instance can
//     never render a page from rows that predate a write made elsewhere.
//   • Tag-based invalidation: writes call `invalidateTags([...])` to expire
//     shared Data Cache entries immediately on every instance.
//   • Failures are never cached (a thrown query leaves the cache untouched).
//
// Server-only: it imports `next/cache`. Do not import it from a Client
// Component (only from route handlers, server components and server libs).
// ─────────────────────────────────────────────────────────────

import { unstable_cache, revalidateTag } from "next/cache";

/** Cache tags shared between readers (`cachedRead`) and writers (`invalidateTags`). */
export const CACHE_TAGS = {
  posts: "posts",
  users: "users",
  siteSettings: "site-settings",
  categories: "categories",
  comments: "comments",
  videos: "videos",
  pictures: "pictures",
  announcement: "announcement",
} as const;

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

type L1Entry = { value: unknown; freshUntil: number; staleUntil: number };

const l1 = new Map<string, L1Entry>();
const inflight = new Map<string, Promise<unknown>>();
const namespaceVersions = new Map<string, number>();
const namespaceTags = new Map<string, Set<string>>();

// Aggressive L2 caching: the Data Cache stays fresh for 24h by default,
// because all mutation paths call `invalidateTags()` immediately on write.
// This prevents Supabase egress from draining on repeat page visits.
const DEFAULT_REVALIDATE_S = 86400; // 24 hours

// L1 serving windows are ZERO on purpose.
//
// `invalidateTags()` can only clear the in-process L1 map of the instance that
// ran the write. Any positive window would let OTHER instances keep serving
// pre-write rows for up to `ttlMs + staleMs` — and the ISR render they perform
// with those rows is then cached for the route's whole `revalidate` window
// (the homepage alone caches for an hour). That is exactly how a published
// story failed to show up on the homepage until the next time-based
// revalidation.
//
// Cross-instance freshness now comes from the shared L2 Data Cache, which
// `revalidateTag()` expires globally. L1 survives only as the single-flight
// layer that de-duplicates concurrent callers of the same key.
const DEFAULT_FRESH_MS = 0;
const DEFAULT_STALE_MS = 0;

export interface CachedReadOptions<TArgs extends unknown[]> {
  /** How long Next.js keeps the value in its persistent Data Cache (seconds). */
  revalidate?: number;
  /** Tags that `invalidateTags()` can use to purge this entry. */
  tags?: string[];
  /** Serializable key suffix derived from the call arguments. */
  keyParts?: (args: TArgs) => (string | number | boolean)[];
  /**
   * L1 in-process serving window (ms). Defaults to 0 — L1 then only
   * de-duplicates concurrent callers and never serves a stored value.
   * Only set this for data whose staleness cannot poison an ISR render
   * (display-only counters, for example).
   */
  ttlMs?: number;
  /** Extra window (ms) in which stale L1 values are served while refreshing. */
  staleMs?: number;
}

/**
 * Wrap a DB read with the L1/L2 cache, single-flight de-duplication and
 * stale-while-revalidate. Returns an async function with the same signature.
 */
export function cachedRead<TArgs extends unknown[], TResult>(
  namespace: string,
  fn: (...args: TArgs) => Promise<TResult>,
  options: CachedReadOptions<TArgs> = {}
): (...args: TArgs) => Promise<TResult> {
  const revalidate = options.revalidate ?? DEFAULT_REVALIDATE_S;
  const tags = options.tags ?? [];
  const ttlMs = options.ttlMs ?? DEFAULT_FRESH_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const registeredTags = namespaceTags.get(namespace) ?? new Set<string>();
  for (const tag of tags) registeredTags.add(tag);
  namespaceTags.set(namespace, registeredTags);
  if (!namespaceVersions.has(namespace)) namespaceVersions.set(namespace, 0);

  const partsFor = (args: TArgs): string[] => {
    const parts = options.keyParts ? options.keyParts(args) : (args as unknown[]);
    return parts.map((p) => String(p));
  };
  const cacheKey = (args: TArgs) => [namespace, ...partsFor(args)].join("|");
  const dataCache = (args: TArgs) =>
    unstable_cache(() => fn(...args), [namespace, ...partsFor(args)], { revalidate, tags });

  const refresh = (key: string, args: TArgs): Promise<TResult> => {
    const version = namespaceVersions.get(namespace) ?? 0;
    const promise = dataCache(args)()
      .then((value) => {
        if (namespaceVersions.get(namespace) === version && inflight.get(key) === promise) {
          const now = Date.now();
          l1.set(key, { value, freshUntil: now + ttlMs, staleUntil: now + ttlMs + staleMs });
          inflight.delete(key);
        }
        return value;
      })
      .catch((err) => {
        if (inflight.get(key) === promise) inflight.delete(key);
        throw err;
      });
    inflight.set(key, promise);
    return promise;
  };

  return async (...args: TArgs): Promise<TResult> => {
    const key = cacheKey(args);
    const now = Date.now();
    const entry = l1.get(key);

    if (entry) {
      if (now < entry.freshUntil) return entry.value as TResult;
      if (now < entry.staleUntil) {
        // Serve the stale value immediately; repopulate in the background.
        if (!inflight.has(key)) refresh(key, args).catch(() => {});
        return entry.value as TResult;
      }
    }

    const pending = inflight.get(key);
    if (pending) return pending as Promise<TResult>;
    return refresh(key, args);
  };
}

/** Drop L1 entries. Pass a namespace to clear only that group. */
export function clearMemoryCache(namespace?: string): void {
  const namespaces = namespace ? [namespace] : Array.from(namespaceTags.keys());
  for (const name of namespaces) {
    namespaceVersions.set(name, (namespaceVersions.get(name) ?? 0) + 1);
    const prefix = `${name}|`;
    for (const key of Array.from(l1.keys())) {
      if (key === name || key.startsWith(prefix)) l1.delete(key);
    }
    for (const key of Array.from(inflight.keys())) {
      if (key === name || key.startsWith(prefix)) inflight.delete(key);
    }
  }
}

/**
 * Purge tagged L2 Data Cache entries. Must run inside a route handler or
 * server action so Next.js can apply the invalidation.
 */
export function invalidateTags(tags: CacheTag | CacheTag[] | string | string[]): void {
  const list = Array.isArray(tags) ? tags : [tags];
  const invalidatedNamespaces = new Set<string>();
  for (const [namespace, namespaceTagSet] of namespaceTags) {
    if (list.some((tag) => namespaceTagSet.has(tag))) invalidatedNamespaces.add(namespace);
  }
  for (const namespace of invalidatedNamespaces) clearMemoryCache(namespace);
  // Next 16 requires a cache profile as `revalidateTag`'s second argument.
  // `{ expire: 0 }` expires the tags NOW — the documented route-handler
  // equivalent of Server-Action `updateTag` — so the next read anywhere is a
  // hard miss that goes back to the database.
  //
  // The built-in `"max"` profile is stale-while-revalidate: the FIRST read
  // after a write still returns the PRE-write value while refreshing in the
  // background. The render triggered by `revalidatePath()` right after a
  // publish would then bake pre-write rows into a page that Next caches for
  // another full `revalidate` window — the homepage for an hour.
  for (const tag of list) revalidateTag(tag, { expire: 0 });
}

/** Standard CDN cache headers for endpoints where brief response staleness is acceptable. */
export function cdnHeaders({
  maxAge = 60,
  sMaxAge = 300,
  staleWhileRevalidate = 600,
}: { maxAge?: number; sMaxAge?: number; staleWhileRevalidate?: number } = {}): Record<string, string> {
  return {
    "Cache-Control": `public, max-age=${maxAge}, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
  };
}
