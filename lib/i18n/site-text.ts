import type { Locale } from "./locale";
import type { SiteConfig } from "@/lib/config";

/**
 * English overlays for the site-wide strings stored in `site_settings.config`.
 *
 * The database remains the single source of truth for the Bangla copy. The
 * English text is curated here so no DB migration is needed and an admin's
 * Bangla edit is never clobbered by an English default.
 */
export const SITE_TEXT_OVERRIDES = {
  title: { en: "Choti Kahini" },
  shortName: { en: "Choti Kahini" },
  tagline: { en: "Bengali erotic stories, affairs and serial tales" },
  description: {
    en: "A collection of Bengali erotic stories, affairs and serial tales — browse and read at your own pace.",
  },
  copyright: { en: "Choti Kahini" },
  seo: {
    titleTemplate: { en: "%s — Choti Kahini" },
    defaultTitle: {
      en: "Bengali Erotic Stories — Choti Kahini",
    },
    description: {
      en: "Read Bengali erotic stories, affairs and serial tales on Choti Kahini — new tales published every day.",
    },
    siteName: { en: "Choti Kahini" },
  },
} as const;

/**
 * Return a copy of the site config with the English strings applied.
 *
 * Every other field — theme colours, logo, URLs, analytics ids, social
 * links, the SEO keyword list — is carried over untouched.
 */
export function localizeSiteConfig(
  site: SiteConfig,
  locale: Locale,
): SiteConfig {
  if (locale === "bn") return site;

  const overrides = SITE_TEXT_OVERRIDES;

  return {
    ...site,
    title: overrides.title.en,
    shortName: overrides.shortName.en,
    tagline: overrides.tagline.en,
    description: overrides.description.en,
    copyright: overrides.copyright.en,
    seo: {
      ...site.seo,
      titleTemplate: overrides.seo.titleTemplate.en,
      defaultTitle: overrides.seo.defaultTitle.en,
      description: overrides.seo.description.en,
      siteName: overrides.seo.siteName.en,
    },
  };
}
