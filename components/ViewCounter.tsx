"use client";

import { useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { fetchJson } from "@/lib/client-fetch";
import { getVisitorId } from "@/lib/client-visitor-id";
import { publishViewCount } from "@/lib/view-count-client";

/**
 * Story view counter.
 *
 * The story page is ISR'd (its HTML carries the count from whenever it was
 * last revalidated), so:
 *
 *   • FIRST visit in a tab → POST /api/views records the view and the
 *     server replies with the fresh total, which is shown immediately;
 *   • REVISIT / refresh in the same tab → no repeat POST (dedupe), but the
 *     edge-cached GET fetches the CURRENT total. Previously a revisit just
 *     replayed the number stored in sessionStorage, so after other readers
 *     had moved the count, a refresh still showed the old figure — which
 *     looked exactly like "the view count never goes up".
 *
 * The tab flag is written only after the server confirms the POST, so a
 * failed ping is retried on the next visit instead of being lost.
 */
export function ViewCounter({ slug }: { slug: string }) {
  const [views, setViews] = useState<number | null>(null);

  // One POST per mounted page visit. The ref stops React StrictMode's
  // double-invoked effect (dev) and any remount from double counting; the
  // SERVER no longer de-duplicates per reader, so every real visit counts.
  const postedRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    const show = (n: number) => {
      if (!isMounted) return;
      setViews(n);
      publishViewCount(`story:${slug}`, n);
    };

    if (postedRef.current) return;
    postedRef.current = true;

    // The POST both records the view and returns the authoritative
    // post-increment total — the number rendered here is never a cached copy.
    fetch("/api/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug,
        visitorId: getVisitorId(),
        referrer: typeof document !== "undefined" ? document.referrer || "" : "",
      }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (typeof data.views === "number") show(data.views);
      })
      .catch(() => {
        // Counting failed: read the stored total instead of inventing one.
        fetchJson<{ views?: number }>(`/api/views?slug=${encodeURIComponent(slug)}`)
          .then((data) => {
            if (typeof data.views === "number") show(data.views);
          })
          .catch(() => {});
      });

    return () => {
      isMounted = false;
    };
  }, [slug]);

  if (views === null) return null;

  return (
    <span className="flex items-center gap-1.5" title={`${views} বার পড়া হয়েছে`}>
      <Eye className="h-3.5 w-3.5 flex-shrink-0" />
      <span>{views} ভিউ</span>
    </span>
  );
}
