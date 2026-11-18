"use client";

import { useEffect, useRef } from "react";
import { getVisitorId } from "@/lib/client-visitor-id";
import { publishViewCount } from "@/lib/view-count-client";

/**
 * Records ONE view per gallery page visit and publishes the exact
 * post-increment count so the on-page label matches the database.
 *
 * Counting policy (owner requirement): every visit counts — there is no
 * 24h / 10min viewer window any more. The only guard is a per-mount ref,
 * which stops React StrictMode's double-invoked effect from counting one
 * visit twice.
 *
 * Thumbnail grids, listings and preloads do NOT mount this component — it
 * only exists on the gallery detail page, so rendering a card is never
 * counted as a view.
 */
export function PictureViewTracker({ galleryId }: { galleryId: string }) {
  const postedRef = useRef(false);

  useEffect(() => {
    if (!galleryId || postedRef.current) return;
    postedRef.current = true;

    const storageKey = `picture:${galleryId}`;

    // `keepalive` lets the request survive the visitor navigating away
    // immediately — which is common on a gallery page.
    fetch(`/api/pictures/${galleryId}/view`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId: getVisitorId() }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.viewCount === "number") {
          publishViewCount(storageKey, data.viewCount);
        }
      })
      .catch(() => {
        // Counting failed: keep the server-rendered label; next visit retries.
      });
  }, [galleryId]);

  return null;
}
