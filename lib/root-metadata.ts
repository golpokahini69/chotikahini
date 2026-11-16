import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/config";
import { getAllKeywordPhrases } from "@/lib/keyword-engine";
import { toSiteOgUrl } from "@/lib/og-urls";
import { normalizeTwitterHandle } from "@/lib/metadata";
import { sanitizeForSocial, sanitizeTitleForSocial } from "@/lib/social-text";
import { loadSiteSettings } from "@/lib/site-settings";

/**
 * Root-layout metadata for the Bangla site.
 */
export async function buildRootMetadata(): Promise<Metadata> {
  try {
    await loadSiteSettings();
  } catch (error) {
    console.error(
      "[site-settings] Metadata using cached/default settings:",
      error,
    );
  }
  const site = getSiteConfig();

  // Enrich site keywords with search.md data
  const searchMdPhrases = getAllKeywordPhrases().slice(0, 10).join(", ");
  const siteKeywords = site.seo?.keywords
    ? `${site.seo.keywords}, ${searchMdPhrases}`
    : searchMdPhrases;

  const baseUrl = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  const ogImgForShare = toSiteOgUrl(site);

  // The homepage's <title> is the default title, which already carries the
  // full brand line. The OpenGraph and Twitter titles must be the SAME
  // string, otherwise a shared homepage link shows a different headline
  // than the search result for it.
  //
  // The default title is used verbatim — the title template is NOT applied
  // to it, because Next.js skips the template for a page's `default` title.
  // Applying it here would brand the homepage twice.
  const homeTitle = site.seo?.defaultTitle || `${site.title} — ${site.tagline}`;

  // Social crawlers classify the card *text* as well as the card image, so
  // the `og:*` / `twitter:*` copies are sanitised. The `<title>`,
  // `<meta name="description">` and `<meta name="keywords">` below keep the
  // full editorial text — that is what the site ranks for, and gutting the
  // keywords would destroy organic search on exactly the terms it targets.
  const socialTitle = sanitizeTitleForSocial(homeTitle);
  const socialDescription = sanitizeForSocial(
    site.seo?.description || site.description,
  );

  return {
    title: {
      default: homeTitle,
      template: site.seo.titleTemplate || `%s — ${site.title}`,
    },
    description: site.seo?.description || site.description,
    metadataBase: new URL(baseUrl),
    keywords: siteKeywords,
    alternates: {
      canonical: baseUrl,
      // Auto-discovery: readers look for <link rel="alternate"> in the
      // <head> to find the feed without the visitor having to know the
      // URL. Without it the site looks like it has no feed at all.
      types: {
        "application/rss+xml": `${baseUrl}/rss.xml`,
      },
      // The English locale was removed from this project, so the only
      // declared alternate is the Bangla one. Advertising an "en-US"
      // alternate pointing at /en told Google that a second, equivalent
      // version of every page existed at a URL that 308-redirects away —
      // a self-inflicted duplicate-content signal.
      languages: {
        "bn-BD": baseUrl,
      },
    },
    openGraph: {
      title: socialTitle,
      description: socialDescription,
      url: baseUrl,
      siteName: site.seo?.siteName || site.title,
      locale: "bn_BD",
      type: "website",
      images: ogImgForShare
        ? [
            {
              url: ogImgForShare,
              secureUrl: ogImgForShare.replace(/^http:/, "https:"),
              width: 1200,
              height: 630,
              alt: socialTitle,
            },
          ]
        : [],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description: socialDescription,
      images: ogImgForShare ? [ogImgForShare] : [],
      creator: normalizeTwitterHandle(site.seo?.twitterCreator),
    },
    icons: site.favicon
      ? [{ rel: "icon", url: site.favicon }]
      : site.logo
        ? [{ rel: "icon", url: site.logo }]
        : [],
    robots: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    verification: {
      google: site.seo?.googleSearchConsole || undefined,
      ...(site.seo?.bingVerification
        ? { bing: site.seo.bingVerification }
        : {}),
    },
    other: {
      "theme-color": site.seo?.themeColor || "#2c2c2c",
      // The site's honest content rating — it used to be hardcoded to
      // "general", which mislabelled an explicit-story site. Facebook's
      // classifier reads the rating.
      rating: site.seo?.rating || "adult",
    },
  };
}
