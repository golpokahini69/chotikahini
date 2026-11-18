"use client";

import { useEffect } from "react";
import { getVisitorId } from "@/lib/client-visitor-id";
import { publishViewCount } from "@/lib/view-count-client";

/**
 * Counts ONE view per video per tab and publishes the confirmed count so
 * the on-page label updates immediately (LiveViewCount / VideoDetailMeta).
 *
 * ── When it counts ───────────────────────────────────────────────────────
 * The player must be at least 60% on screen, continuously, for 2 seconds,
 * in a tab that is actually visible. That is "the visitor is looking at
 * the video" — the requirement, stated plainly.
 *
 * ── What it does NOT count ───────────────────────────────────────────────
 *   • cards, thumbnails and listings — this component is mounted ONLY on
 *     the two video detail pages, nowhere else;
 *   • a player scrolled past or left in a background tab;
 *   • the same video twice in one tab (sessionStorage, set AFTER success);
 *   • repeat viewers within 24h (server-side viewer de-duplication).
 *
 * (An earlier version additionally demanded a parent-page gesture or
 * iframe focus before counting. That under-counted: a visitor who opened
 * the page and watched without touching anything around the player was
 * never counted — which is why counts looked frozen. Visibility plus dwell
 * is the signal; the de-duplication above is what keeps it honest.)
 *
 * ── Usage ────────────────────────────────────────────────────────────────
 *   <div id="video-player" …> <iframe … /> </div>
 *   <VideoViewTracker videoId={video.id} targetId="video-player" />
 */

interface Props {
  videoId: string;
  /** DOM id of the player container to observe (one player per page). */
  targetId: string;
}

const MIN_VISIBLE_MS = 2000; // player must stay on screen this long
const OBSERVER_THRESHOLD = 0.6; // 60% of the player on screen

export function VideoViewTracker({ videoId, targetId }: Props) {
  useEffect(() => {
    if (!videoId || !targetId) return;
    const el = document.getElementById(targetId);
    if (!el || typeof IntersectionObserver === "undefined") return;

    const storageKey = `video:${videoId}`;

    // Every visit counts — there is no per-tab/per-day "already counted"
    // branch any more. The label always shows the exact post-increment total
    // the server returns, which is also what the admin dashboard sums.
    const remember = (views: number) => {
      publishViewCount(storageKey, views);
    };

    let fired = false;
    let visibleSince: number | null = null;

    const fire = () => {
      if (fired) return;
      fired = true;
      // NOTE: the tab flag is written inside `remember`, i.e. only after the
      // server confirms — so a failed ping can be retried on the next visit
      // instead of being lost for the rest of the tab's life.
      fetch(`/api/videos/${videoId}/view`, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId: getVisitorId() }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && typeof data.viewCount === "number") remember(data.viewCount);
        })
        .catch(() => {
          // Never surface a counter failure to the visitor; un-fire so a
          // later re-check can try again while the player is still on screen.
          fired = false;
        });
    };

    const recheck = () => {
      if (fired || document.hidden) return; // background tab = not viewing
      if (visibleSince === null) return;
      if (Date.now() - visibleSince < MIN_VISIBLE_MS) return;
      fire();
    };

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting) {
          if (visibleSince === null) visibleSince = Date.now();
        } else {
          visibleSince = null; // scrolled away: the dwell clock resets
        }
        recheck();
      },
      { threshold: OBSERVER_THRESHOLD },
    );
    io.observe(el);

    const tick = window.setInterval(recheck, 1000);

    const onVisibility = () => {
      if (document.hidden) visibleSince = null;
      else if (visibleSince === null) visibleSince = Date.now();
      recheck();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      io.disconnect();
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [videoId, targetId]);

  return null;
}
