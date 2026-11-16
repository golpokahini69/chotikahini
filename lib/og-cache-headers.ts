// ── Shared OpenGraph image cache headers ───────────────────────
//
// `stale-while-revalidate` used to be 604800 (7 days), which meant the
// edge could keep serving a stale card for a week. That mattered when
// the cards themselves were wrong: the previous cards embedded explicit
// imagery, and a week-long stale window meant the fix did not take
// effect for most shared links.
//
// The window is now one hour. `s-maxage` stays at a day so the edge
// still absorbs crawler traffic without invoking the function, and
// `max-age` is short because a browser cache entry is pointless for a
// crawler but harmless either way.
export const OG_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=3600",
  "CDN-Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
} as const;
