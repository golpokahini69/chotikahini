"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LayoutGrid, Plus, ListVideo, Power } from "lucide-react";

/**
 * Sub-navigation for the picture hub at /admin/pictures.
 *
 * The default tab is "সব" (everything): the publish form, the stats and the
 * gallery list all on one screen, so the admin never has to switch tabs to
 * see what is already published. The individual tabs (পাবলিশ / লিস্ট / সেটিংস)
 * remain available for focused work.
 */
const PICTURE_TABS = [
  { key: "all", label: "সব", href: "/admin/pictures?view=all", icon: LayoutGrid },
  { key: "publish", label: "পাবলিশ", href: "/admin/pictures?view=publish", icon: Plus },
  { key: "list", label: "লিস্ট", href: "/admin/pictures?view=list", icon: ListVideo },
  { key: "settings", label: "সেটিংস", href: "/admin/pictures?view=settings", icon: Power },
] as const;

export function PictureHubNav() {
  const params = useSearchParams();
  const view = params.get("view") || "all";

  return (
    <nav
      aria-label="ছবি হাব"
      className="sticky top-0 z-10 -mx-4 mb-5 border-b border-border bg-surface/95 px-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      <div className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {PICTURE_TABS.map((tab) => {
          const active = view === tab.key;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={
                "inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-semibold transition " +
                (active
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-fg-muted hover:bg-surface-hover hover:text-fg")
              }
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
