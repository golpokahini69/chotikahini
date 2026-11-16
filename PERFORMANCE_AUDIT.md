# GolpoKahini Performance Audit

Date: 2026-11-17

## Scope and evidence

This audit is based on the repository's Next.js routes, server libraries, client components, cache helpers, and SQL scripts. Production CDN, Vercel, and Supabase dashboards were not available from the repository, so runtime metrics and production cache-hit behavior remain unverified.

## Current architecture

- Next.js 16.4.5 with the App Router, React 19.2.0, and Supabase JS 2.112.3.
- Public routes generally use ISR. Story pages use 24-hour revalidation; most listings and media pages use 1-hour revalidation.
- `lib/cache.ts` provides process memory caching, Next Data Cache via `unstable_cache`, single-flight refreshes, stale-while-revalidate behavior, and tagged invalidation.
- Public JSON routes use `Cache-Control` headers. Admin layouts and authenticated routes remain dynamic and are not suitable for shared CDN caching.
- Images use responsive Next Image settings with AVIF/WebP and a 31-day minimum cache TTL. Video and picture media are generally delivered directly with `unoptimized` images.

## What is cached

- Published stories, users, story content, search results, videos, pictures, trending data, announcements, and site settings have shared cache wrappers in `lib/`.
- Public page output uses route-level `revalidate` values.
- RSS and sitemap responses use long route revalidation and public cache headers.
- Announcement writes invalidate the announcement tag and affected paths.

## Important cache gaps

- The announcement API `GET` previously bypassed the shared announcement loader. It now uses `getAnnouncement`, so a CDN miss can use the L1/Data Cache rather than querying Supabase directly.
- Story listings and several filters still load a broad catalogue and filter or slice in application code. This creates cold-cache database transfer and server CPU costs even though the result is cached afterward.
- Search can perform multiple `ILIKE` scans and loads broad user/story data. A database-side search RPC or indexed search strategy is the largest likely query optimization, but it requires query-plan and schema validation before changing.
- Trending also performs broad post, likes, metadata, and view reads on a cold cache.
- Story view writes use read-then-write counters. In-memory deduplication is instance-local and cannot guarantee correctness across Vercel instances.

## Dynamic and recurring traffic

- Admin and authentication paths are intentionally dynamic because they depend on cookies and authorization.
- The client auth provider calls `/api/auth/me` on browser load, including public visits.
- The notification bell polls approximately every three minutes for logged-in users.
- Presence heartbeat sends an immediate request and then approximately every five minutes from the public shell.
- The announcement banner is server-rendered and does not need a browser fetch for normal page loads.

## Highest-impact safe sequence

1. Measure production headers and route timings with repeated requests, then record Vercel Function Invocations, Fluid Active CPU, CDN HIT/MISS, response sizes, and Supabase request/egress metrics.
2. Replace broad public catalogue reads with database-side pagination and narrow projections, starting with homepage and listing routes.
3. Add or verify composite/partial indexes for published story/media listings and public slug lookups using `EXPLAIN (ANALYZE, BUFFERS)` in Supabase.
4. Replace application-side search scans with a reviewed PostgreSQL search RPC and pagination. Do not deploy this without checking Bengali text behavior and RLS/security boundaries.
5. Add an atomic post-view increment RPC modeled on the existing video/picture view flow. This is a database migration and should be deployed only after approval and verification against existing counters.
6. Re-check client polling and authenticated bootstrap requests after measuring their real contribution. Preserve notifications, presence, and auth behavior.

## Production verification commands

Run against the deployed URL, not only localhost:

```bash
curl -sS -D - -o /dev/null https://YOUR_DOMAIN/
curl -sS -D - -o /dev/null https://YOUR_DOMAIN/sitemap.xml
curl -sS -D - -o /dev/null 'https://YOUR_DOMAIN/api/search?q=...'
```

Repeat each request and record `x-vercel-cache`, `cache-control`, `cdn-cache-control`, status, and response size. Confirm public routes never include private/session data, and confirm admin/auth responses are not publicly cacheable.

## Validation status

- Repository audit: complete.
- Announcement API cache consistency fix: applied.
- Production cache metrics: unavailable without the deployed URL and dashboard access.
- Database query plans and live index state: unavailable from source alone.
- Typecheck: blocked because `tsc` is unavailable before dependency installation.
- Dependency installation and build/lint: blocked by the repository disk guard (`0.1 GiB` free; `4 GiB` required).