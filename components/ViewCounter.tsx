"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    let isMounted = true;
    const sessionKey = `post_views_${slug}`;
    const show = (n: number) => {
      if (!isMounted) return;
      setViews(n);
      publishViewCount(`story:${slug}`, n);
    };

    const readStored = (): number | null => {
      try {
        const stored = sessionStorage.getItem(sessionKey);
        if (stored === null) return null;
        const n = Number(stored);
        return Number.isFinite(n) ? n : null;
      } catch {
        return null;
      }
    };

    const storedCount = readStored();

    const readCurrent = () =>
      fetchJson<{ views?: number }>(`/api/views?slug=${encodeURIComponent(slug)}`).then(
        (data) => {
          if (typeof data.views === "number") show(data.views);
          else if (storedCount !== null) show(storedCount);
        },
      );

    if (storedCount !== null) {
      // Counted in this tab already: don't re-POST, but do refresh the
      // number so a refresh cannot show a stale count.
      readCurrent().catch(() => {
        if (storedCount !== null) show(storedCount);
      });
      return () => {
        isMounted = false;
      };
    }

    // The POST both records the view and returns the fresh count, so a
    // successful first view costs exactly one request.
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
        if (typeof data.views === "number") {
          try {
            sessionStorage.setItem(sessionKey, String(data.views));
          } catch {}
          show(data.views);
        }
      })
      .catch(() => {
        // Write path failed: fall back to the cached read (shared across
        // visitors at the edge) so the label is still correct, and leave the
        // tab flag unset so the NEXT visit retries the actual count.
        readCurrent().catch(() => {
          /* leave the counter hidden rather than showing a wrong number */
        });
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
