import { MessageSquare } from "lucide-react";
import { PostFeed } from "@/components/posts/PostFeed";
import { t } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The community posts page, shared by both locales.
 */
export function PostsView({ locale }: { locale: Locale }) {
  return (
    <div className="container-page py-8 sm:py-12">
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-alt border border-border text-blue-500">
            <MessageSquare className="w-5 h-5" />
          </span>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="h-1 w-1 rounded-full bg-fg" />
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
                {locale === "en" ? "Community" : "কমিউনিটি"}
              </h2>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg">
              {locale === "en" ? "What everyone is writing" : "সবাই যা লিখছেন"}
            </h1>
          </div>
        </header>
        <p className="text-sm text-fg-muted -mt-2 mb-2">
          {locale === "en"
            ? "Discuss opinions, experiences and stories — like and comment to join in."
            : "মতামত, অভিজ্ঞতা ও গল্প নিয়ে আলোচনা করুন — লাইক ও মন্তব্যে অংশ নিন।"}
        </p>

        <PostFeed locale={locale} />
      </div>
    </div>
  );
}
