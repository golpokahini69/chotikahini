"use client";

/**
 * Retired.
 *
 * Kept as an exported no-op so the story page does not have to change its
 * import graph, and so an in-flight deploy cannot reference a missing
 * module. The per-visit record it used to send is no longer collected —
 * aggregate story views are recorded by <ViewCounter> via `record_post_view`,
 * which also maintains the daily rollup the admin charts read.
 */
export function PageVisitTracker(_props: { slug: string }) {
  return null;
}
