"use client";

import { useEffect } from "react";
import { getVisitorId } from "@/lib/client-visitor-id";

/**
 * Fires a single POST to /api/videos/[id]/view when the page settles.
 *
 * The endpoint de-dupes per IP for 30 minutes so a single session doesn't
 * inflate the counter. Render this anywhere on the detail page — it has no
 * UI of its own.
 */
export function VideoViewTracker({ videoId }: { videoId: string }) {
  useEffect(() => {
    const id = setTimeout(() => {
      fetch(`/api/videos/${videoId}/view`, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        // A stable id keeps de-duplication right when the client IP is
        // hidden behind a proxy (ip|ua alone would collapse viewers).
        body: JSON.stringify({ visitorId: getVisitorId() }),
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(id);
  }, [videoId]);
  return null;
}