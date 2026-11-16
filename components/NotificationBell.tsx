"use client";

import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { Bell, KeyRound, CheckCircle2, PenLine, XCircle, Download, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { UserAvatar } from "./UserAvatar";
import { useRouter } from "next/navigation";
import { formatDate , enToBnNumber, normalizeRef } from '@/lib/utils';
import { fetchJson } from "@/lib/client-fetch";

interface Notification {
  id: string;
  userId: string;
  type: string;
  actorId: string;
  actorName: string;
  actorProfilePic?: string;
  postSlug: string;
  commentId: string;
  snippet: string;
  isRead: boolean;
  /** Legacy alias kept in sync with `isRead` by the optimistic update. */
  read?: boolean;
  createdAt: string;
}

export function NotificationBell({ onUnreadCountChange }: { onUnreadCountChange?: (count: number) => void }) {
  const { user } = useAuth();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // The dropdown is `position: fixed` and anchored to the bell button.
  //
  // It CANNOT be `absolute` inside the header: the header bar carries
  // `overflow-hidden` (to clip the animated logo/bar geometry), and an
  // absolutely-positioned descendant gets clipped by that — the dropdown was
  // cut off right below the header, showing only a sliver. A fixed
  // positioned element is laid out against the viewport and is not clipped
  // by an ancestor's overflow.
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  useLayoutEffect(() => {
    if (!isOpen) return;

    const position = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();

      // Right-align the panel with the bell, but never let it overflow the
      // viewport horizontally.
      const panelWidth = window.innerWidth < 640 ? window.innerWidth - 24 : 320;
      let left = rect.right - panelWidth;
      left = Math.max(12, Math.min(left, window.innerWidth - panelWidth - 12));

      // Open downwards when there is room, otherwise flip above the bell.
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < 320 && rect.top > spaceBelow;

      setDropdownStyle({
        left: `${left}px`,
        ...(openUp
          ? { bottom: `${window.innerHeight - rect.top + 8}px` }
          : { top: `${rect.bottom + 8}px` }),
      });
    };

    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      onUnreadCountChange?.(0);
      return;
    }

    const fetchNotifs = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const data = await fetchJson<{ notifications?: Notification[] }>("/api/notifications", {
          ttlMs: 60_000,
        });
        setNotifications(data.notifications || []);
      } catch (e) {
        console.error(e);
      }
    };

    fetchNotifs();

    // Poll only while the reader is actually looking at the tab, and only
    // every 5 minutes. A fixed 3-minute interval kept a request (and its
    // response) flowing for every signed-in tab that was merely open in
    // the background, which is pure egress for data nobody was reading.
    const POLL_MS = 5 * 60 * 1000;
    let interval: number | undefined = window.setInterval(fetchNotifs, POLL_MS);

    const onVisibility = () => {
      if (document.hidden) {
        if (interval !== undefined) window.clearInterval(interval);
        interval = undefined;
      } else {
        // Coming back to the tab is exactly when a fresh list matters.
        fetchNotifs();
        if (interval === undefined) interval = window.setInterval(fetchNotifs, POLL_MS);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (interval !== undefined) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user, onUnreadCountChange]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const unreadCount = notifications.filter(n => !n.isRead && !(n as any).read).length;

  // Report the count upward so a parent (the mobile bottom nav) can show it
  // without running a second, divergent fetch of the same endpoint.
  useEffect(() => {
    onUnreadCountChange?.(unreadCount);
  }, [unreadCount, onUnreadCountChange]);

  if (!user) return null;

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllRead: true }),
      });
      if (!res.ok) {
        console.error("Failed to mark all notifications read:", res.status);
        return;
      }
      // Only update local state once the server confirmed the write.
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true, read: true })));
    } catch (e) {
      console.error("Failed to mark all notifications read:", e);
    } finally {
      setMarkingAll(false);
    }
  };

  const handleRead = async (notification: any) => {
    setIsOpen(false);

    // Optimistically mark the notification as read in local state so the
    // bell badge and "X অপঠিত" pill update instantly. We revert this on
    // API failure so the UI never shows a false "read" state.
    const wasUnread = !notification.isRead && !notification.read;
    if (wasUnread) {
      setNotifications(prev =>
        prev.map(n => n.id === notification.id ? { ...n, isRead: true, read: true } : n)
      );

      try {
        const res = await fetch("/api/notifications/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notificationId: notification.id })
        });
        if (!res.ok) {
          // 404 (foreign / unknown id) or 5xx — roll the optimistic update
          // back so the next poll can reconcile from the source of truth.
          setNotifications(prev =>
            prev.map(n => n.id === notification.id ? { ...n, isRead: false, read: false } : n)
          );
        }
      } catch (e) {
        console.error(e);
        setNotifications(prev =>
          prev.map(n => n.id === notification.id ? { ...n, isRead: false, read: false } : n)
        );
      }
    }

    const cleanSlug = notification.postSlug ? normalizeRef(notification.postSlug) : "";

    if (notification.type === "forgot_password_request") {
      // Admin-facing type: the request came FROM this user and the admin
      // has to act on it in the user-management panel.
      router.push("/admin/users");
    } else if (
      notification.type === "password_reset_link_generated" ||
      notification.type === "password_reset_completed" ||
      notification.type === "password_reset_by_admin"
    ) {
      // Password-reset notifications have no post slug — the relevant
      // place is the user's own profile / account page.
      router.push("/profile");
    } else if (cleanSlug && notification.commentId) {
      router.push(`/${cleanSlug}#comment-${notification.commentId}`);
    } else if (cleanSlug) {
      router.push(`/${cleanSlug}`);
    } else {
      router.push("/profile");
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors focus:outline-none"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-surface shadow-sm"></span>
        )}
      </button>

      {isOpen && (
        <div
          style={dropdownStyle}
          className="fixed w-[calc(100vw-1.5rem)] sm:w-80 max-h-[min(70vh,28rem)] overflow-y-auto overscroll-contain bg-surface border border-border rounded-2xl shadow-2xl z-[60] animate-in fade-in zoom-in-95 duration-200"
        >
          <div className="sticky top-0 bg-surface/95 backdrop-blur border-b border-border p-3 flex justify-between items-center gap-2 z-10">
            <h3 className="font-bold text-fg text-sm flex items-center gap-1.5">
              <Bell className="w-4 h-4 text-accent" /> বিজ্ঞপ্তি
            </h3>
            {unreadCount > 0 ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleMarkAllRead}
                  disabled={markingAll}
                  className="text-[11px] font-semibold text-accent hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  {markingAll ? "হচ্ছে..." : "সব পড়া হয়েছে"}
                </button>
                <span className="text-xs text-red-500 font-semibold bg-red-50 dark:bg-red-950/30 px-2 py-0.5 rounded-full border border-red-200 dark:border-red-800">
                  {enToBnNumber(unreadCount)}টি অপঠিত
                </span>
              </div>
            ) : (
              <span className="text-xs text-fg-subtle">সব পঠিত</span>
            )}
          </div>

          <div className="divide-y divide-border">
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-sm text-fg-muted italic">
                কোনো নোটিফিকেশন নেই।
              </div>
            ) : (
              notifications.map((notif: any) => {
                const isUnread = !notif.isRead && !notif.read;
                return (
                  <button
                    key={notif.id}
                    onClick={() => handleRead(notif)}
                    className={`w-full text-left p-3 hover:bg-surface-alt transition-colors flex gap-3 items-start ${isUnread ? "bg-accent/5 dark:bg-accent/10" : ""}`}
                  >
                    <div className="w-8 h-8 rounded-full flex-shrink-0 overflow-hidden">
                      <UserAvatar src={notif.actorProfilePic} name={notif.actorName || "Admin"} size="md" className="w-full h-full rounded-full" />
                    </div>
<div className="flex-1 min-w-0">
                      {notif.type === "forgot_password_request" ? (
                        <p className="text-xs text-fg font-medium leading-snug">
                          <KeyRound className="w-4 h-4 inline mr-1 text-amber-500" /><span className="font-bold">{notif.actorName}</span> পাসওয়ার্ড রিসেটের অনুরোধ করেছেন
                        </p>
                      ) : notif.type === "password_reset_link_generated" ? (
                        <p className="text-xs text-fg font-medium leading-snug">
                          <KeyRound className="w-4 h-4 inline mr-1 text-amber-500" />আপনার পাসওয়ার্ড রিসেটের লিঙ্ক তৈরি হয়েছে
                        </p>
                      ) : notif.type === "password_reset_completed" ? (
                        <p className="text-xs text-fg font-medium leading-snug">
                          <CheckCircle2 className="w-4 h-4 inline mr-1 text-green-500" />আপনার পাসওয়ার্ড পরিবর্তন করা হয়েছে
                        </p>
                      ) : notif.type === "password_reset_by_admin" ? (
                        <p className="text-xs text-fg font-medium leading-snug">
                          <KeyRound className="w-4 h-4 inline mr-1 text-purple-500" />অ্যাডমিন আপনার পাসওয়ার্ড পরিবর্তন করেছেন
                        </p>
                      ) : notif.type === "story_approved" ? (
                        <p className="text-xs text-fg font-medium leading-snug"><CheckCircle2 className="w-4 h-4 inline mr-1 text-green-500" />গল্প অনুমোদিত ও প্রকাশিত হয়েছে</p>
                      ) : notif.type === "story_revision_requested" ? (
                        <p className="text-xs text-fg font-medium leading-snug"><PenLine className="w-4 h-4 inline mr-1 text-amber-500" />গল্পে সংশোধন প্রস্তাব করা হয়েছে</p>
                      ) : notif.type === "story_rejected" ? (
                        <p className="text-xs text-fg font-medium leading-snug"><XCircle className="w-4 h-4 inline mr-1 text-red-500" />গল্পটি প্রত্যাখ্যান করা হয়েছে</p>
                      ) : notif.type === "story_unpublished" ? (
                        <p className="text-xs text-fg font-medium leading-snug"><Download className="w-4 h-4 inline mr-1 text-blue-500" />গল্পটি ড্রাফটে স্থানান্তরিত হয়েছে</p>
                      ) : notif.type === "story_deleted" ? (
                        <p className="text-xs text-fg font-medium leading-snug"><Trash2 className="w-4 h-4 inline mr-1 text-red-500" />গল্পটি মুছে ফেলা হয়েছে</p>
                      ) : notif.type === "reply" || notif.type === "comment_reply" ? (
                        <p className="text-xs text-fg">
                          <span className="font-semibold">{notif.actorName}</span> আপনার মন্তব্যে উত্তর দিয়েছেন
                        </p>
                      ) : notif.message ? (
                        <p className="text-xs text-fg font-medium leading-snug">{notif.message}</p>
                      ) : (
                        <p className="text-xs text-fg">
                          <span className="font-semibold">{notif.actorName}</span> একটি নোটিফিকেশন পাঠিয়েছেন
                        </p>
                      )}
                      {notif.snippet && <p className="text-xs text-fg-muted line-clamp-2 italic mt-0.5 whitespace-pre-line">&ldquo;{notif.snippet}&rdquo;</p>}
                      <p className="text-[10px] text-fg-subtle mt-1">{formatDate(notif.createdAt)}</p>
                    </div>
                    {isUnread && (
                      <div className="w-2 h-2 bg-accent rounded-full mt-1.5 flex-shrink-0"></div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
