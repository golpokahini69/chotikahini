import { createHash } from "node:crypto";

// ─────────────────────────────────────────────────────────────
// lib/view-count.ts — one shared store for every view counter on the site.
//
// WHAT THIS IS
//   A single in-process layer that answers two questions for story,
//   video and picture view counts:
//
//     1. "Has this viewer already been counted recently?"  (dedupe)
//     2. "What is the current count, without asking the DB?" (read cache)
//
//   The database stays the source of truth (atomic `record_*_view` RPCs
//   do insert + increment in one statement). This layer only stops the
//   same viewer from generating repeat writes, and stops repeat reads.
//
// WHY IN-PROCESS AND NOT REDIS
//   This project runs on the Vercel free plan with no external services
//   permitted, so there is no shared Redis/Upstash to reach for. What
//   matters about a Redis layer here is what it would do: hold the dedupe
//   window and the hot count in memory so neither the read nor the write
//   touches the database on every request. That part is reproduced exactly,
//   per serverless instance.
//
//   Honest limitation: this cache is per-instance and is lost on cold
//   start, so after a cold start a viewer can be counted twice on the same
//   day. The database RPC still applies its own (video/picture) unique-key
//   dedupe, so at worst the number is correct and the *writes* are saved —
//   never inflated by the app, and never inflated by DB-side logic.
//
//   If a shared store is ever allowed, replace `counts`/`seen` below with
//   it: the exported API is deliberately the same shape (get/set/increment
//   and a time-windowed "is this new" probe).
//

// Server-only: route handlers import this. Do not import it from a Client
// Component.
// ─────────────────────────────────────────────────────────────

/** How long a known count is served without touching the database. */
const COUNT_TTL_MS = 60_000; // 1 minute

/**
 * Hard cap on entries so an unbounded set of slugs/ids can never grow the
 * process heap. Beyond the cap the oldest entries are dropped first.
 */
const MAX_ENTRIES = 10_000;

type CountEntry = { value: number; expires: number };

/** slug/id → current count with its freshness deadline. */
const counts = new Map<string, CountEntry>();

/** dedupe key → timestamp until which this viewer is already counted. */
const seen = new Map<string, number>();

/** Insert order, so eviction can drop the oldest entry. */
const countOrder = new Map<string, number>();
let clock = 0;

function evictIfFull(map: Map<string, unknown>): void {
  if (map.size <= MAX_ENTRIES) return;
  // Maps iterate in insertion order, so the first key is the oldest.
  const oldest = map.keys().next().value;
  if (oldest !== undefined) map.delete(oldest);
}

/**
 * Read a count from memory.
 * @returns the cached value, or null when unknown / stale.
 */
export function getCachedCount(key: string): number | null {
  const entry = counts.get(key);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    counts.delete(key);
    countOrder.delete(key);
    return null;
  }
  return entry.value;
}

/** Store a count that the database just confirmed. */
export function setCachedCount(key: string, value: number, ttlMs = COUNT_TTL_MS): void {
  counts.set(key, { value, expires: Date.now() + ttlMs });
  countOrder.delete(key);
  countOrder.set(key, ++clock);
  // Simple two-pass trim: delete until it fits.
  while (counts.size > MAX_ENTRIES) {
    const oldest = countOrder.keys().next().value;
    if (oldest === undefined) break;
    countOrder.delete(oldest);
    counts.delete(oldest);
  }
}

/**
 * Apply a confirmed increment without another read.
 * Keeps the cached number in step with the write that just happened.
 */
export function bumpCachedCount(key: string, delta = 1, ttlMs = COUNT_TTL_MS): void {
  const current = getCachedCount(key);
  if (current === null) return; // unknown here — next read will refill it
  setCachedCount(key, current + delta, ttlMs);
}

/**
 * Has this viewer already been counted inside their window?
 *
 * Read-only on purpose: the caller records the hit only AFTER the database
 * confirms the increment. Checking first and recording immediately (the
 * obvious one-liner) would swallow the view whenever the write failed —
 * the viewer looks counted, the number never moves, and no retry happens.
 */
export function isCounted(key: string): boolean {
  const until = seen.get(key);
  return until !== undefined && until > Date.now();
}

/** Record that `key` has now been counted, for `windowMs`. */
export function markCounted(key: string, windowMs: number): void {
  seen.set(key, Date.now() + windowMs);
  evictIfFull(seen);
}

/**
 * Build the per-viewer dedupe key for a request.
 *
 * Prefers the client's stable `visitorId` (the same id story views use),
 * because it survives IP changes, VPN hops and UA spoofing that would
 * otherwise make the server-side ip|ua fallback count one person many
 * times — or, when a proxy hides the client IP entirely, collapse every
 * visitor into the same bucket and count almost nobody.
 *
 * Falls back to sha256(ip | user-agent | day) when the client did not send
 * an id, so counting still works for a cached HTML page that never ran JS.
 */
export function buildViewerKey(
  req: Request,
  clientId?: string | null,
  dayBucketMs = 24 * 60 * 60 * 1000,
): string {
  const clean = (clientId || "").trim().slice(0, 64);
  if (clean) return `c:${clean}`;

  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip =
    fwd.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip") ||
    "anon";
  const ua = req.headers.get("user-agent") || "";
  const day = Math.floor(Date.now() / dayBucketMs);
  // Hashed so the key carries no raw IP/user-agent in process memory.
  return `h:${createHash("sha256").update(`${ip}|${ua}|${day}`).digest("hex")}`;
}
