import type { Metadata } from "next";
import { getSiteConfig, getAuthors, type SiteConfig, type Author } from "@/lib/config";
import { buildMetadata } from "@/lib/metadata";
import { localizeSiteConfig } from "@/lib/i18n/site-text";
import { t } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/locale";

export interface AboutData {
  site: SiteConfig;
  authors: Author[];
}

/** Data for the About page. */
export function getAboutData(): AboutData {
  return {
    site: getSiteConfig(),
    authors: getAuthors(),
  };
}

export function aboutMetadata(locale: Locale): Metadata {
  const site = localizeSiteConfig(getSiteConfig(), locale);
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;

  return buildMetadata({
    title:
      locale === "en"
        ? `About — ${site.title}`
        : `সম্পর্কে — ${site.title}`,
    description:
      locale === "en"
        ? `${site.description} — learn more about this website`
        : `${site.description} — এই ওয়েবসাইট সম্পর্কে জানুন`,
    url: locale === "en" ? `${base}/en/about` : `${base}/about`,
    locale,
    skipKeywordTitle: true,
  });
}
