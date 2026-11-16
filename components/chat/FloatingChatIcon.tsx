"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchJson } from "@/lib/client-fetch";

export function FloatingChatIcon() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    const fetchUnread = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const data = await fetchJson<{ unread?: number }>("/api/chat/unread-count", {
          ttlMs: 60_000,
        });
        setUnreadCount(data.unread || 0);
      } catch {}
    };
    fetchUnread();

    // Poll at most every 10 minutes, and only while the tab is visible.
    // A background tab was previously billing a request every 3 minutes
    // for a badge nobody was looking at.
    const POLL_MS = 10 * 60 * 1000;
    let interval: number | undefined = window.setInterval(fetchUnread, POLL_MS);

    const onVisibility = () => {
      if (document.hidden) {
        if (interval !== undefined) window.clearInterval(interval);
        interval = undefined;
      } else {
        fetchUnread();
        if (interval === undefined) {
          interval = window.setInterval(fetchUnread, POLL_MS);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (interval !== undefined) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user]);

  // Hide the floating icon if the user is already on the chat page or admin pages
  if (pathname === "/chat" || pathname.startsWith("/admin")) return null;

  return (
    <Link 
      href="/chat"
      className="md:hidden fixed bottom-20 right-4 sm:bottom-24 sm:right-6 z-40 flex items-center justify-center w-14 h-14 bg-blue-600 dark:bg-blue-600 text-white rounded-full shadow-lg shadow-blue-600/30 hover:bg-blue-700 active:scale-95 transition-all"
      aria-label="চ্যাট করুন"
    >
      <MessageCircle className="w-6 h-6" />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white border-2 border-surface">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
