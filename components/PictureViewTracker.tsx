"use client";

import { useEffect } from "react";
import { getVisitorId } from "@/lib/client-visitor-id";
import { publishViewCount } from "@/lib/view-count-client";

/**
 * Records ONE view per picture gallery per tab, and publishes the confirmed
 * count so the on-page label updates immediately (LiveViewCount).
 *
 * Thumbnail grids, listings and preloads do NOT mount this component — it
 * only exists on the two gallery detail pages, so rendering an image card
 * is never counted as a view.
 *
 * The tab-level flag is written ONLY AFTER the server confirms the write.
 * Writing it optimistically (before the request) meant one failed ping made
 * that tab permanently blind: the view was never recorded and could never
 * be retried, which is exactly how counts looked "stuck". The server still
 * de-dupes per viewer per 24h, so a retry after a success costs nothing.
 */
export function PictureViewTracker({ galleryId }: { galleryId: string }) {
  useEffect(() => {
    if (!galleryId) return;

    const storageKey = `picture:${galleryId}`;
    const sessionKey = `picture_view:${galleryId}`;

    // Counted in this tab already? Do not re-POST (dedupe), but still ask
    // the edge-cached endpoint for the current total — otherwise a revisit
    // in the same tab shows whatever number was stored, not today's.
    let countedBefore = false;
    try {
      countedBefore = sessionStorage.getItem(sessionKey) !== null;
    } catch {
      // sessionStorage blocked: fall through, server de-dupes regardless.
    }

    const remember = (views: number) => {
      try {
        sessionStorage.setItem(sessionKey, String(views));
      } catch {
        /* best effort */
      }
      publishViewCount(storageKey, views);
    };

    if (countedBefore) {
      fetch(`/api/pictures/${galleryId}/view`, {
        headers: { Accept: "application/json" },
        cache: "force-cache",
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && typeof data.viewCount === "number") {
            publishViewCount(storageKey, data.viewCount);
          }
        })
        .catch(() => {
          /* keep the server-rendered number */
        });
      return;
    }

    // `keepalive` lets the request survive the visitor navigating away
    // immediately — which is common when they click "মূল সাইটে দেখুন".
    fetch(`/api/pictures/${galleryId}/view`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      // Same stable id the story counter uses, so a proxy-hidden IP cannot
      // collapse every visitor into one dedupe bucket.
      body: JSON.stringify({ visitorId: getVisitorId() }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.viewCount === "number") remember(data.viewCount);
      })
      .catch(() => {
        // A failed view ping is never worth surfacing to the visitor, and
        // because nothing was written to sessionStorage the NEXT visit can
        // retry instead of being locked out for this tab.
      });
  }, [galleryId]);

  return null;
}
