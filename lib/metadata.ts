import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/config";
import type { SiteConfig } from "@/lib/config";
import { toSiteOgUrl } from "@/lib/og-urls";
import { sanitizeForSocial, sanitizeTitleForSocial } from "@/lib/social-text";
import type { Locale } from "@/lib/i18n/locale";
import { DEFAULT_LOCALE } from "@/lib/i18n/locale";
import {
  findMatchingClusters,
  generateSeoTitle,
  generateSeoDescription,
  generateKeywordsTag,
  getAllKeywordPhrases,
} from "@/lib/keyword-engine";

/* ── Build a fully-populated Metadata object from site config + overrides ── */

interface PageMetaInput {
  title: string;
  description?: string;
  keywords?: string;
  /** Full URL of this page, used for canonical & OG url. */
  url?: string;
  /** Image path (absolute or relative to site root). */
  image?: string;
  /** Page type hint for OG. */
  type?: "website" | "article";
  /** Robots directive. */
  robots?: string;
  /** Optional text content for keyword matching (e.g. page content) */
  content?: string;
  /**
   * Which language this page is rendered in. Drives `openGraph.locale`.
   */
  locale?: Locale;
  /**
   * Skip keyword enrichment of the title.
   *
   * The root layout already ends every title with the site's brand phrase
   * ("… — বাংলা চটি গল্প | Chotikahini"), which is the site's primary
   * keyword. Enriching a hub page's title on top of that produced
   * "ক্যাটাগরি - বাংলা চটি গল্প — বাংলা চটি গল্প | Chotikahini" — the same
   * phrase twice, which Google reads as a near-duplicate title. Hub and
   * listing pages therefore opt out and let the template brand them once.
   */
  skipKeywordTitle?: boolean;
}

/** The OpenGraph locale tag for each of our locales. */
const OG_LOCALE: Record<Locale, string> = { bn: "bn_BD", en: "en_US" };

function siteUrl(site: SiteConfig): string {
  return site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
}

/**
 * Remove a trailing site-name suffix from a page title.
 *
 * The root layout applies the site's title template (`%s — বাংলা চটি গল্প |
 * Chotikahini`) to every page. A number of routes additionally appended
 * `site.title` themselves, which produced doubled branding such as
 * "সম্পর্কে — বাংলা চটি কাহিনী — বাংলা চটি গল্প | Chotikahini".
 *
 * Google truncates long titles and treats near-identical titles as a
 * duplicate-content signal, so the brand name must appear exactly once.
 */
export function stripSiteBranding(title: string, site: SiteConfig): string {
  const brand = site.title?.trim();
  if (!brand) return title;

  // Title is *only* the brand — nothing to brand with. Fall back to the
  // configured default title so the template has something to work with.
  if (title.trim() === brand) {
    return site.seo?.defaultTitle || title;
  }

  for (const sep of [" — ", " - ", " | "]) {
    const suffix = `${sep}${brand}`;
    if (title.endsWith(suffix)) {
      return title.slice(0, title.length - suffix.length);
    }
  }
  return title;
}

/**
 * The Latin brand name used on social cards.
 *
 * The site's own name is Bengali ("বাংলা চটি কাহিনী"), which is three
 * times longer than the Latin name and reads as a second language when
 * appended to a headline that is usually English. The Latin name is
 * taken from the site's own host — `chotikahini.vercel.app` →
 * `Chotikahini` — so it stays correct if the domain is ever pointed
 * at a different brand.
 */
const SOCIAL_BRAND = "Chotikahini";

/**
 * Apply a *short* brand suffix to the OpenGraph / Twitter title.
 *
 * The `<title>` tag gets the full template
 * (`%s — বাংলা চটি গল্প | Chotikahini`) from the root layout. That suffix
 * is 32 characters long, and social platforms show roughly the first 60
 * characters of a card before truncating — so a long brand suffix pushes
 * the actual headline off the visible part of the card.
 *
 * The social copy therefore gets a much shorter suffix. The headline
 * stays readable, and the branding is not lost: it is still in
 * `og:site_name`, and on the card image itself.
 *
 * The suffix is the Latin brand name rather than the Bengali one. The
 * site's own name is Bengali, so a Bengali suffix on a card whose
 * headline is usually English reads as a mismatched second language —
 * and it is three times longer than the Latin name for the same brand.
 */
export function socialBrandTitle(title: string, site: SiteConfig): string {
  const trimmed = title.trim();
  if (!trimmed) return trimmed;

  // The homepage's default title already carries the full brand line —
  // branding it again would repeat it.
  const defaultTitle = site.seo?.defaultTitle?.trim();
  if (defaultTitle && trimmed === defaultTitle) return trimmed;

  const brand = SOCIAL_BRAND;
  if (!brand) return trimmed;

  // A title that already ends in the brand is left alone.
  for (const sep of [" | ", " — ", " - "]) {
    if (trimmed.endsWith(`${sep}${brand}`)) return trimmed;
  }

  return `${trimmed} | ${brand}`;
}

/**
 * Normalize a Twitter/X handle for the `twitter:site` / `twitter:creator`
 * meta tags.
 *
 * Twitter only accepts an `@handle` or a full profile URL. The stored
 * config value was the site root path (`"/"`), which rendered as
 * `twitter:site="/"` — an invalid value that Twitter rejects when it
 * decides whether to attribute the card. A malformed handle can also make
 * the crawler fall back to a plain text card, which is exactly the
 * "title only, no image" symptom.
 *
 * Returns `undefined` when there is no usable handle so the tag is omitted
 * entirely rather than emitted with a broken value.
 */
export function normalizeTwitterHandle(value?: string | null): string | undefined {
  const raw = (value || "").trim();
  if (!raw) return undefined;

  // A bare path or a URL with no @handle in it is not a Twitter identity.
  if (!raw.includes("@")) return undefined;

  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      const url = new URL(raw);
      const handle = url.pathname.split("/").filter(Boolean)[0];
      return handle ? `@${handle}` : undefined;
    } catch {
      return undefined;
    }
  }

  return raw.startsWith("@") ? raw : `@${raw}`;
}

/**
 * Return complete Metadata for any page — OG, Twitter, canonical, robots, etc.
 *
 * Every page calls this so the metadata is consistent across the entire site.
 * Now enriched with keyword data from search.md via the keyword engine.
 */
export function buildMetadata(input: PageMetaInput): Metadata {
  const site = getSiteConfig();
  const base = siteUrl(site);
  const locale = input.locale ?? DEFAULT_LOCALE;
  const pageUrl = input.url || base;
  const description = input.description || site.seo?.description || site.description;
  const imageUrl = input.image
    ? input.image.startsWith("http://") || input.image.startsWith("https://")
      ? input.image
      : `${base}${input.image.startsWith("/") ? input.image : `/${input.image}`}`
    : toSiteOgUrl(site);
  const robotsVal = input.robots || site.seo?.robots || "index, follow";

  // Find keyword clusters from content/title for SEO enrichment
  const searchText = `${input.title} ${description} ${input.content || ""}`;
  const matches = findMatchingClusters(searchText, 2);

  // Enrich title and description with keyword data
  const baseTitle = stripSiteBranding(input.title, site);
  const seoTitle = input.skipKeywordTitle
    ? baseTitle
    : generateSeoTitle(baseTitle, matches);
  const seoDescription = generateSeoDescription(description, matches);
  const seoKeywords = input.keywords || generateKeywordsTag(matches, site.seo?.keywords);

  // The `<title>` is rendered through the root layout's template
  // (`%s — বাংলা চটি গল্প | Chotikahini`), but the OpenGraph and Twitter
  // titles are NOT — Next.js does not apply the template to them. That
  // left every social card showing a bare "প্রেম" while the search
  // result showed "প্রেম — বাংলা চটি গল্প | Chotikahini". The social
  // headline must carry the same brand suffix as the search headline,
  // otherwise a shared link shows a different title than the SERP.
  //
  // The social copy gets the *short* brand suffix rather than the full
  // template. The full suffix is 32 characters and platforms show only
  // about the first 60 characters of a card, so with the full suffix the
  // headline itself was pushed off the visible part of the card.
  const brandedTitle = socialBrandTitle(
    sanitizeTitleForSocial(seoTitle),
    site,
  );

  // ── Social copy is a sanitised variant of the search copy ──
  //
  // Social crawlers run a content classifier over the card *text* as well
  // as the card image. An explicit term in `og:description` is enough for
  // Facebook/X to suppress the whole card, even when the image is clean.
  //
  // `<title>`, `<meta name="description">` and `<meta name="keywords">`
  // keep the full editorial text — they are what the site ranks for, and
  // gutting the keywords would destroy organic search on exactly the terms
  // the site targets. Only the `og:*` / `twitter:*` copies are sanitised.
  //
  // The title uses `sanitizeTitleForSocial`, which replaces a removed
  // term with a neutral word instead of deleting it — deleting it left a
  // hole in the middle of the headline ("Mutual scene and Powerful
  // scene scene" reads as broken). It runs on the headline *before*
  // the brand suffix is added, so the filler word matches the
  // headline's own language.
  const socialTitle = brandedTitle;
  const socialDescription = sanitizeForSocial(seoDescription);

  const robotsDirective: Record<string, boolean> = {};
  if (robotsVal.includes("noindex")) robotsDirective.index = false;
  else robotsDirective.index = true;
  if (robotsVal.includes("nofollow")) robotsDirective.follow = false;
  else robotsDirective.follow = true;

  return {
    title: seoTitle,
    description: seoDescription,
    keywords: seoKeywords,
    metadataBase: new URL(base),
    authors: site.seo?.author ? [{ name: site.seo.author }] : [],
    robots: robotsDirective,
    alternates: {
      canonical: pageUrl,
      // Feed auto-discovery. Readers look for <link rel="alternate"> in the
      // <head> to find the site's feed; without it a reader that was only
      // given the homepage URL cannot find the feed at all. Declared on
      // every page, because a reader may land on a story page first.
      types: {
        "application/rss+xml": `${base}/rss.xml`,
      },
    },
    openGraph: {
      title: socialTitle,
      description: socialDescription,
      type: input.type || "website",
      url: pageUrl,
      siteName: site.seo?.siteName || site.title,
      locale: OG_LOCALE[locale],
      images: imageUrl
        ? [{ url: imageUrl, secureUrl: imageUrl.replace(/^http:/, "https:"), width: 1200, height: 630, alt: socialTitle }]
        : [],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description: socialDescription,
      images: imageUrl ? [imageUrl] : [],
      site: normalizeTwitterHandle(site.seo?.twitterCreator),
    },
    other: {
      "theme-color": site.seo?.themeColor || "#2c2c2c",
      // The site's honest content rating. It used to be hardcoded to
      // "general", which mislabelled an explicit-story site — Facebook's
      // classifier reads the rating, and a false "general" is what got the
      // share cards suppressed.
      rating: site.seo?.rating || "adult",
    },
  };
}

/**
 * Convenience: build page metadata with the site's default title appended
 * for listing / taxonomy pages (e.g. "বিভাগ — বাংলা চটি কাহিনী").
 * Now enriched with keyword data for better SEO.
 */
export function buildListingMetadata(
  title: string,
  description: string,
  url?: string,
  /** Optional category id for keyword matching */
  categoryId?: string,
  locale?: Locale,
): Metadata {
  // The root layout already applies the site's title template (`%s — <site>`)
  // to every page title. Appending `site.title` here as well produced a
  // doubled title like "সম্পর্কে — বাংলা চটি কাহিনী — বাংলা চটি গল্প | Chotikahini".
  // Listing pages therefore pass the bare title through and let the root
  // template do the branding exactly once.
  //
  // Keyword enrichment is skipped for the same reason: the template's
  // suffix already carries the site's primary keyword phrase, so appending
  // it again repeated the phrase within the title.
  const fullTitle = title;

  // Find relevant keywords for this listing page
  const searchText = `${title} ${description}`;
  const matches = findMatchingClusters(searchText, 2);

  const seoDescription = generateSeoDescription(description, matches);

  return buildMetadata({
    title: fullTitle,
    description: seoDescription,
    url,
    locale,
    skipKeywordTitle: true,
  });
}

/**
 * Build metadata for taxonomy/listing pages with pagination.
 */
export function buildPagedMetadata(
  title: string,
  description: string,
  url: string,
  pageNum: number,
  locale?: Locale,
): Metadata {
  // `site.title` is intentionally NOT appended here — the root layout's
  // title template already brands every page title exactly once.
  const pagedTitle =
    locale === "en" ? `Page ${pageNum} — ${title}` : `পাতা ${pageNum} — ${title}`;
  const pagedDesc =
    locale === "en"
      ? `${description} — Page ${pageNum}`
      : `${description} — পাতা ${pageNum}`;
  return buildMetadata({
    title: pagedTitle,
    description: pagedDesc,
    url,
    locale,
    skipKeywordTitle: true,
  });
}
