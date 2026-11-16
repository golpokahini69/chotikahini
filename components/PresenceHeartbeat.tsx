"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { postJsonBeacon } from "@/lib/client-fetch";

// Presence ping. Deliberately infrequent: this is a beacon per open tab,
// and the only thing it feeds is an in-memory "active now" counter that
// forgets a visitor after a few idle minutes anyway. Pinging every 5
// minutes from every open tab (the old value) is a steady stream of
// requests that costs egress and buys nothing — one ping when a tab
// becomes visible is enough to represent "this reader is here now".
const MIN_GAP_MS = 10 * 60 * 1000;

export function PresenceHeartbeat() {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const visitorIdRef = useRef("");
  const lastSentRef = useRef(0);

  // Track the current route without re-registering listeners on navigation
  // (this component lives in the root shell and never unmounts).
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    // Never count admin panel visits as site visitors.
    if (pathnameRef.current.startsWith("/admin")) return;

    let visitorId = "";
    try {
      visitorId = localStorage.getItem("site_visitor_id") || "";
      if (!visitorId) {
        visitorId = "vis_" + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
        localStorage.setItem("site_visitor_id", visitorId);
      }
    } catch {
      visitorId = "anon_" + Date.now();
    }
    visitorIdRef.current = visitorId;

    const send = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const now = Date.now();
      if (now - lastSentRef.current < MIN_GAP_MS) return;
      lastSentRef.current = now;
      postJsonBeacon("/api/analytics/heartbeat", {
        visitorId: visitorIdRef.current,
        pagePath: pathnameRef.current,
      });
    };

    send();

    // No interval at all. A tab only re-pings when the reader comes back
    // to it, which is exactly the moment presence becomes true again.
    const onVisibility = () => {
      if (!document.hidden) send();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
