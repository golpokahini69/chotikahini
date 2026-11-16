"use client";

import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { fetchJson } from "@/lib/client-fetch";

function getVisitorId(): string {
  try {
    let id = localStorage.getItem("site_visitor_id");
    if (!id) {
      id = "vis_" + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
      localStorage.setItem("site_visitor_id", id);
    }
    return id;
  } catch {
    return `vis_${Date.now()}`;
  }
}

export function ViewCounter({ slug }: { slug: string }) {
  const [views, setViews] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;
    const sessionKey = `post_views_${slug}`;

    // Once a story has been counted in this tab session, reuse the number the
    // server sent back — no repeat POST, no repeat GET on every navigation
    // back to the same story.
    try {
      const stored = sessionStorage.getItem(sessionKey);
      if (stored !== null) {
        const n = Number(stored);
        if (Number.isFinite(n)) {
          setViews(n);
          return;
        }
      }
    } catch {}

    const remember = (n: number) => {
      if (!isMounted) return;
      setViews(n);
      try {
        sessionStorage.setItem(sessionKey, String(n));
      } catch {}
    };

    // The POST both records the view and returns the fresh count, so a
    // successful view costs exactly one request.
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
        if (typeof data.views === "number") remember(data.views);
      })
      .catch(async () => {
        // Fall back to a cached read (shared/de-duplicated by lib/client-fetch)
        // only when the write path failed.
        try {
          const data = await fetchJson<{ views?: number }>(
            `/api/views?slug=${encodeURIComponent(slug)}`,
          );
          if (typeof data.views === "number") remember(data.views);
        } catch {
          // leave the counter hidden
        }
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
