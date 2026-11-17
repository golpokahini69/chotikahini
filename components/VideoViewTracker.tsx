"use client";

import { useEffect } from "react";
import { getVisitorId } from "@/lib/client-visitor-id";

/**
 * Counts a video view only when the viewer is genuinely watching —
 * NOT on page load.
 *
 * ── Why mount-based counting was wrong ───────────────────────────────────
 * The old version fired 1.5s after the component mounted, so merely opening
 * a video page, a thumbnail hover that navigated, a link prefetch or a
 * player that never got pressed all inflated the count. Cards, thumbnails,
 * iframes and embeds are now explicitly NOT counted.
 *
 * ── The rule used here (fires once, never more) ──────────────────────────
 * All conditions must hold:
 *   1. the player container is on screen (IntersectionObserver, ≥60% of it
 *      visible) continuously for ≥2 seconds, and the tab is visible;
 *   2. and one of:
 *        a. the embed URL asked for autoplay — the video IS playing, so
 *           visibility alone is a genuine watch start;
 *        b. a real human signal reached us: a parent-page gesture
 *           (pointerdown/keydown/wheel/touchstart), the iframe receiving
 *           focus (clicking inside a cross-origin iframe focuses its element
 *           in the parent document — that is how a user presses "play"),
 *           or a pointer over the player itself;
 *   3. not already counted for this video in this tab (sessionStorage).
 *
 * A bare page load fails (2): no gesture, no focus, no hover, no autoplay —
 * so crawlers-with-JS, idle tabs, preloads and accidental navigations do not
 * count. Bots that do not run JS fail (1) and (2) both.
 *
 * Server-side, /api/videos/[id]/view de-duplicates per viewer per 24h
 * (and the in-process store answers repeats without touching the database),
 * so a repeated "play" event storm from the player still counts once.
 *
 * Provider note: playback itself stays inside the provider iframe — we do
 * not add SDKs, postMessage contracts or proxies for events. For the one
 * provider that tells us it is playing (autoplay=1 in the embed URL),
 * condition 2a uses that fact.
 *
 * ── Usage ────────────────────────────────────────────────────────────────
 *   <div id="video-player" className="...">  ← the container to observe
 *     <iframe … />
 *   </div>
 *   <VideoViewTracker videoId={video.id} targetId="video-player"
 *                     autoplay={hasAutoplay} />
 */

interface Props {
  videoId: string;
  /** DOM id of the player container to observe (one player per page). */
  targetId: string;
  /** True when the embed URL starts playing by itself (autoplay=1). */
  autoplay?: boolean;
}

const MIN_VISIBLE_MS = 2000; // player must stay on screen this long
const OBSERVER_THRESHOLD = 0.6; // 60% of the player on screen

export function VideoViewTracker({ videoId, targetId, autoplay = false }: Props) {
  useEffect(() => {
    if (!videoId || !targetId) return;
    const el = document.getElementById(targetId);
    if (!el || typeof IntersectionObserver === "undefined") return;

    const sessionKey = `video_view:${videoId}`;
    try {
      if (sessionStorage.getItem(sessionKey)) return; // already counted in this tab
    } catch {
      // sessionStorage blocked: fall through, server-side dedupe still holds.
    }

    let fired = false;
    let visibleSince: number | null = null;
    let humanSignal = false;

    const fire = () => {
      if (fired) return;
      fired = true;
      try {
        sessionStorage.setItem(sessionKey, String(Date.now()));
      } catch {
        /* best effort — the server de-dupes anyway */
      }
      fetch(`/api/videos/${videoId}/view`, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId: getVisitorId() }),
      }).catch(() => {
        // A failed counter ping is never worth surfacing to the visitor.
      });
    };

    const recheck = () => {
      if (fired) return;
      if (document.hidden) return; // background tab = not watching
      if (visibleSince === null) return;
      if (Date.now() - visibleSince < MIN_VISIBLE_MS) return;
      if (!autoplay && !humanSignal) return; // bare page load never counts
      fire();
    };

    // (1) on-screen ≥2s, tracked by a one-second tick while visible.
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

    // (2b) human signals. Clicks INSIDE a cross-origin iframe never reach
    // the parent, but focusing it does — pressing play in the provider
    // player focuses the <iframe> element here, which is the reliable
    // parent-side trace of that click.
    const gesture = () => {
      humanSignal = true;
      recheck();
    };
    const onFocusIn = (e: FocusEvent) => {
      if (e.target === el || (e.target instanceof Node && el.contains(e.target))) {
        gesture();
      }
    };

    const opts = { passive: true } as AddEventListenerOptions;
    window.addEventListener("pointerdown", gesture, opts);
    window.addEventListener("keydown", gesture, opts);
    window.addEventListener("wheel", gesture, opts);
    window.addEventListener("touchstart", gesture, opts);
    window.addEventListener("focusin", onFocusIn, opts);
    el.addEventListener("pointerover", gesture, opts);

    const onVisibility = () => {
      if (document.hidden) visibleSince = null;
      else if (visibleSince === null && el) visibleSince = Date.now();
      recheck();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      io.disconnect();
      window.clearInterval(tick);
      window.removeEventListener("pointerdown", gesture, opts);
      window.removeEventListener("keydown", gesture, opts);
      window.removeEventListener("wheel", gesture, opts);
      window.removeEventListener("touchstart", gesture, opts);
      window.removeEventListener("focusin", onFocusIn, opts);
      el.removeEventListener("pointerover", gesture, opts);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [videoId, targetId, autoplay]);

  return null;
}
