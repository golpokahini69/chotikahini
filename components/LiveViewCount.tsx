"use client";

import { Eye } from "lucide-react";
import { enToBnNumber } from "@/lib/utils";
import { useViewCount } from "@/lib/view-count-client";

/**
 * Live view-count label for image / gallery / video detail pages.
 *
 * The number the server rendered is only as fresh as the render — the view
 * itself is recorded by a tracker that runs AFTER hydration, so the label
 * used to stay frozen for the whole visit (the reported bug: "view count
 * barhe na"). This subscribes to the count the tracker publishes once the
 * server confirms it, so the number moves during the same page load.
 *
 * Renders nothing while the count is 0, matching the previous behaviour of
 * hiding the badge for uncounted content — except it now APPEARS as soon as
 * the tracker gets its confirmation.
 *
 * `storageKey` must match the key the tracker publishes:
 *   picture → `picture:${galleryId}`   video → `video:${videoId}`
 */
export function LiveViewCount({
  storageKey,
  initial,
}: {
  storageKey: string;
  initial: number;
}) {
  const views = useViewCount(storageKey, initial);
  if (!views || views <= 0) return null;

  return (
    <>
      <span aria-hidden className="text-border/80">
        ·
      </span>
      <span className="inline-flex items-center gap-1 tabular-nums">
        <Eye className="h-3.5 w-3.5" />
        {enToBnNumber(views)} ভিউ
      </span>
    </>
  );
}
