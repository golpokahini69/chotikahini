"use client";

import { useState } from "react";
import Link from "next/link";
import { Megaphone, X } from "lucide-react";
import type { Announcement } from "@/lib/announcement";

/**
 * Presentational half of the announcement banner. Only the dismiss button
 * needs client state — the text itself arrives server-rendered.
 */
export function AnnouncementBannerClient({ announcement }: { announcement: Announcement }) {
  const [dismissed, setDismissed] = useState(false);

  if (!announcement.active || !announcement.text || dismissed) return null;

  const colors: Record<string, string> = {
    blue: "bg-blue-600 text-white",
    amber: "bg-amber-500 text-white",
    red: "bg-red-600 text-white",
    green: "bg-green-600 text-white",
  };

  const colorClass = colors[announcement.color] || colors.blue;

  return (
    <div className={`w-full py-2.5 px-4 text-center text-sm font-medium flex items-center justify-center gap-2.5 ${colorClass} relative z-40 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300`}>
      <Megaphone className="w-4 h-4 shrink-0 opacity-90" />
      <span className="truncate max-w-[85vw] sm:max-w-none">
        {announcement.link ? (
          <Link href={announcement.link} className="underline underline-offset-2 hover:opacity-80 transition-opacity">
            {announcement.text}
          </Link>
        ) : (
          announcement.text
        )}
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 opacity-70 hover:opacity-100 transition-opacity"
        aria-label="বন্ধ করুন"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
