"use client";

import { useEffect } from "react";
import { getVisitorId } from "@/lib/client-visitor-id";

/**
 * Fires this site's own view counter for a gallery.
 *
 * Renders nothing — it only POSTs to /api/pictures/[id]/view once when the
 * page mounts. The endpoint de-duplicates by viewer + 24-hour bucket, so a
 * refresh doesn't inflate the count.
 *
 * This is deliberately separate from the provider's own counter: the number
 * we show as "ভিউ" is traffic on THIS site, not the source site's number.
 */
export function PictureViewTracker({ galleryId }: { galleryId: string }) {
  useEffect(() => {
    if (!galleryId) return;

    // Already counted in this tab (page load, RSC navigation back, refresh):
    // send nothing at all. The server de-dupes per viewer for 24h too, but
    // skipping the request here removes it entirely instead of spending a
    // function invocation + a DB round-trip to be told "already counted".
    const sessionKey = `picture_view:${galleryId}`;
    try {
      if (sessionStorage.getItem(sessionKey)) return;
      sessionStorage.setItem(sessionKey, String(Date.now()));
    } catch {
      // sessionStorage blocked: fall through, server de-dupes regardless.
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
    }).catch(() => {
      // A failed view ping is never worth surfacing to the visitor.
    });
  }, [galleryId]);

  return null;
}
