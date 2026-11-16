import type { Metadata } from "next";
import {
  getAllPostsAsync,
  getFeaturedPosts,
  type PostMeta,
} from "@/lib/posts";
import { POSTS_PER_PAGE, FEATURED_MAX } from "@/lib/constants";
import {
  getSiteConfig,
  isVideoSectionEnabled,
  isPictureSectionEnabled,
  type SiteConfig,
} from "@/lib/config";
import { buildMetadata } from "@/lib/metadata";
import { getAllKeywordPhrases } from "@/lib/keyword-engine";
import { toSiteOgUrl } from "@/lib/og-urls";
import { localizeSiteConfig } from "@/lib/i18n/site-text";
import { t } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/locale";

export interface HomeData {
  site: SiteConfig;
  featured: PostMeta[];
  latest: PostMeta[];
  totalPosts: number;
  totalPages: number;
  videoOn: boolean;
  pictureOn: boolean;
}

/** Homepage data shared by the home view and metadata builder. */
export async function getHomeData(): Promise<HomeData> {
  const site = getSiteConfig();
  const videoOn = isVideoSectionEnabled();
  const pictureOn = isPictureSectionEnabled();
  const allPosts = await getAllPostsAsync();
  const featured = allPosts.filter((p) => p.featured).slice(0, FEATURED_MAX);
  const latest = allPosts.slice(0, POSTS_PER_PAGE);
  const totalPages = Math.ceil(allPosts.length / POSTS_PER_PAGE);

  return {
    site,
    featured,
    latest,
    totalPosts: allPosts.length,
    totalPages,
    videoOn,
    pictureOn,
  };
}

export function homeMetadata(locale: Locale): Metadata {
  const site = localizeSiteConfig(getSiteConfig(), locale);
  const phrases = getAllKeywordPhrases();
  const keywords = site.seo?.keywords
    ? `${site.seo.keywords}, ${phrases.slice(0, 5).join(", ")}`
    : phrases.slice(0, 5).join(", ");
  const homeOgImage = toSiteOgUrl(site);
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  const homeUrl = locale === "en" ? `${base}/en` : base;

  return buildMetadata({
    title:
      site.seo?.defaultTitle ||
      (locale === "en"
        ? `${site.title} — ${t(locale, "home.videosAndStories")}`
        : `${site.title} — ভিডিও ও গল্প`),
    description:
      site.seo?.description ||
      (locale === "en"
        ? `${site.tagline} — the best videos and Bengali stories in one place.`
        : `${site.tagline} — সেরা ভিডিও ও বাংলা চটি গল্প এক জায়গায়।`),
    keywords,
    url: homeUrl,
    image: homeOgImage,
    locale,
    skipKeywordTitle: true,
  });
}
