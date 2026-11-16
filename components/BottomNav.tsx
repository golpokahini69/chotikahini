"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, BookOpen, Search, User } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useState } from "react";
import { NotificationBell } from "./NotificationBell";
import { UserAvatar } from "./UserAvatar";
import { useTranslations } from "@/lib/i18n/use-translations";
import { enToBnNumber } from "@/lib/utils";

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations();
  const { user, openAuthModal } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  const barePath = pathname || "/";

  const isActive = (href: string) => {
    if (href === "/") return barePath === "/";
    return barePath.startsWith(href);
  };

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur-xl border-t border-border">
      <div className="flex items-center justify-around px-1 py-1.5">
        <Link href="/" className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all min-w-[3.25rem] min-h-[44px] justify-center ${isActive("/") ? "text-accent" : "text-fg-muted hover:text-fg"}`}>
          <Home className={`w-5 h-5 transition-transform ${isActive("/") ? "scale-110" : ""}`} />
          <span className={`text-[10px] font-medium leading-none ${isActive("/") ? "font-bold" : ""}`}>{t("bottomNav.home")}</span>
        </Link>

        <Link href="/tags" className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all min-w-[3.25rem] min-h-[44px] justify-center ${isActive("/tags") ? "text-accent" : "text-fg-muted hover:text-fg"}`}>
          <BookOpen className={`w-5 h-5 transition-transform ${isActive("/tags") ? "scale-110" : ""}`} />
          <span className={`text-[10px] font-medium leading-none ${isActive("/tags") ? "font-bold" : ""}`}>{t("bottomNav.tags")}</span>
        </Link>

        <Link href="/search" className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all min-w-[3.25rem] min-h-[44px] justify-center ${isActive("/search") ? "text-accent" : "text-fg-muted hover:text-fg"}`}>
          <Search className={`w-5 h-5 transition-transform ${isActive("/search") ? "scale-110" : ""}`} />
          <span className={`text-[10px] font-medium leading-none ${isActive("/search") ? "font-bold" : ""}`}>{t("bottomNav.search")}</span>
        </Link>

        {user ? (
          <>
            {/* The header bell is hidden below `md`, so mobile had no way to
                open notifications at all. Render it here so the panel is
                reachable on phones too. */}
            <div className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all min-w-[3.25rem] min-h-[44px] justify-center">
              <NotificationBell onUnreadCountChange={setUnreadCount} />
              <span className="text-[10px] font-medium leading-none text-fg-muted">
                {unreadCount > 0 ? `${enToBnNumber(unreadCount)}টি` : t("bottomNav.notifications")}
              </span>
            </div>

            <Link href="/profile" className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all min-w-[3.25rem] min-h-[44px] justify-center ${isActive("/profile") ? "text-accent" : "text-fg-muted hover:text-fg"}`}>
              <span className={`flex w-6 h-6 rounded-full overflow-hidden border transition-all shrink-0 ${isActive("/profile") ? "border-accent ring-1 ring-accent/30" : "border-border"}`}>
                <UserAvatar src={user.profilePic} name={user.name || user.username} userId={user.id} size="sm" className="w-full h-full rounded-full" />
              </span>
              <span className={`text-[10px] font-medium leading-none ${isActive("/profile") ? "font-bold" : ""}`}>{t("bottomNav.profile")}</span>
            </Link>
          </>
        ) : (
          <button onClick={openAuthModal} className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all min-w-[3.25rem] min-h-[44px] justify-center text-fg-muted hover:text-fg">
            <User className="w-5 h-5" />
            <span className="text-[10px] font-medium leading-none">{t("bottomNav.login")}</span>
          </button>
        )}
      </div>
    </nav>
  );
}
