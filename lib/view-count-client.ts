import { useSyncExternalStore } from "react";

// ─────────────────────────────────────────────────────────────
// lib/view-count-client.ts — a tiny in-tab publish/subscribe store for
// view counts, so the NUMBER ON THE PAGE updates the moment a view is
// actually counted.
//
// Why this exists
//   Story, picture and video pages render their view count on the server
//   (from the row read while rendering). The tracker that records the view
//   runs AFTER hydration, so the freshly incremented number never reached
//   the DOM — a visitor would open a page, watch the count stay frozen and
//   conclude counting was broken (the reported bug).
//
//   The tracker and the label are separate components on separate islands,
//   so they need one shared, per-tab channel. This is that channel: no
//   network, no context provider, no re-render of the page — only the
//   subscribed label re-renders.
//
// Server-side remains the source of truth: this store only mirrors the
// value the server returned, and never invents or increments a number.
// ─────────────────────────────────────────────────────────────

type Listener = () => void;

const values = new Map<string, number>();
const listeners = new Map<string, Set<Listener>>();

/** Publish a count the server just confirmed (after a POST/GET succeeds). */
export function publishViewCount(key: string, views: number): void {
  if (!Number.isFinite(views)) return;
  values.set(key, views);
  const set = listeners.get(key);
  if (set) for (const listener of set) listener();
}

/** Latest published count for `key`, or undefined. */
export function getViewCount(key: string): number | undefined {
  return values.get(key);
}

function subscribe(key: string, listener: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(key);
  };
}

/**
 * Subscribe a component to a published count.
 *
 * `initial` is the server-rendered value (or 0) and is used for the first
 * paint and for SSR — the store is per-tab, so it has no server equivalent.
 */
export function useViewCount(key: string, initial: number): number {
  // `useSyncExternalStore` keeps this correct across hydration: the server
  // snapshot and the first client snapshot both return `initial`, so no
  // hydration mismatch, and later publishes re-render only this component.
  return useSyncExternalStore(
    (onChange) => subscribe(key, onChange),
    () => values.get(key) ?? initial,
    () => initial,
  );
}
