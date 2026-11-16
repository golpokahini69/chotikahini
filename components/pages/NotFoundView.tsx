import Link from "next/link";
import { getSiteConfig } from "@/lib/config";
import { localizeSiteConfig } from "@/lib/i18n/site-text";
import { localizeHref } from "@/lib/i18n/links";
import { t } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The 404 page, shared by both locales.
 *
 * The message text comes from the message catalogue, so the Bangla version
 * reads exactly as before and the English version is the translated
 * equivalent.
 */
export function NotFoundView({ locale }: { locale: Locale }) {
  const site = localizeSiteConfig(getSiteConfig(), locale);

  return (
    <div className="container-article py-20 sm:py-28 text-center">
      <h1 className="text-5xl sm:text-7xl font-bold tracking-tight text-fg">
        {locale === "en" ? "404" : "৪০৪"}
      </h1>
      <p className="mt-4 text-base text-fg-muted">
        {t(locale, "common.notFoundTitle")}
      </p>
      <p className="mt-2 text-sm text-fg-subtle">
        {t(locale, "common.notFoundBody")}
      </p>
      <div className="mt-8">
        <Link href={localizeHref("/", locale)} className="btn-primary">
          {locale === "en"
            ? `${site.title} — ${t(locale, "nav.home")}`
            : `${site.title} — হোমপেজ`}
        </Link>
      </div>
    </div>
  );
}
