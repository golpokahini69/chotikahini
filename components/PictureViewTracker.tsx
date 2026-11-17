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
