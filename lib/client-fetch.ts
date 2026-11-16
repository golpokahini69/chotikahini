// ─────────────────────────────────────────────────────────────
// lib/client-fetch.ts — tiny browser-side request helpers.
//
//   fetchJson()      GET with in-flight de-duplication + a short TTL cache,
//                    so two widgets asking for the same URL share ONE request.
//   postJsonBeacon() fire-and-forget POST through `navigator.sendBeacon`
//                    (falls back to a `keepalive` fetch). Analytics pings
//                    never block navigation or keep a connection alive.
//
// Client-only: no imports from `next/cache` or the DB client.
// ─────────────────────────────────────────────────────────────

type CacheEntry = { value: unknown; expires: number };

const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 50;

function prune(now: number) {
  if (memory.size <= MAX_ENTRIES) return;
  for (const [key, entry] of memory) {
    if (entry.expires <= now) memory.delete(key);
  }
  // Still too big? Drop oldest insertions (Map keeps insertion order).
  while (memory.size > MAX_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

/**
 * GET + JSON with a shared cache. Concurrent callers for the same URL get the
 * same promise; later callers get the cached value until `ttlMs` elapses.
 */
export function fetchJson<T = unknown>(
  url: string,
  { ttlMs = 60_000, force = false }: { ttlMs?: number; force?: boolean } = {},
): Promise<T> {
  const now = Date.now();

  if (!force) {
    const cached = memory.get(url);
    if (cached && cached.expires > now) return Promise.resolve(cached.value as T);
  }

  const pending = inflight.get(url);
  if (pending) return pending as Promise<T>;

  const promise = fetch(url, { headers: { Accept: "application/json" } })
    .then(async (res) => {
      if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
      const data = (await res.json()) as T;
      memory.set(url, { value: data, expires: Date.now() + ttlMs });
      prune(Date.now());
      return data;
    })
    .finally(() => {
      if (inflight.get(url) === promise) inflight.delete(url);
    });

  inflight.set(url, promise);
  return promise;
}

/** Drop a cached GET response (e.g. after a write). */
export function invalidateClientCache(url?: string): void {
  if (url) memory.delete(url);
  else memory.clear();
}

/**
 * Fire-and-forget JSON POST.
 *
 * `sendBeacon` is designed for exactly this: the browser queues the payload
 * and delivers it even if the page is being unloaded, without holding a
 * connection or a React render. Same-origin, so no preflight is involved.
 */
export function postJsonBeacon(url: string, data: unknown): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify(data);

  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }
  } catch {
    // fall through to fetch
  }

  try {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // analytics must never break the page
  }
}
