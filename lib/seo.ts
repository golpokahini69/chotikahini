import type { Metadata } from "next";
import { type Post, type PostMeta } from "@/lib/posts";
import { type SiteConfig } from "@/lib/config";
import { normalizeTwitterHandle, socialBrandTitle } from "@/lib/metadata";
import { toPostOgUrl } from "@/lib/og-urls";
import { sanitizeForSocial, sanitizeTitleForSocial } from "@/lib/social-text";
import { enToBnNumber } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/locale";
import { DEFAULT_LOCALE } from "@/lib/i18n/locale";
import {
  findMatchingClusters,
  generateSeoTitle,
  generateSeoDescription,
  generateTags,
  generateKeywordsTag,
  generateJsonLdKeywords,
  type KeywordMatch,
} from "@/lib/keyword-engine";

/** The OpenGraph locale tag for each of our locales. */
const OG_LOCALE: Record<Locale, string> = { bn: "bn_BD", en: "en_US" };

/** The `inLanguage` value used in JSON-LD for each of our locales. */
const IN_LANGUAGE: Record<Locale, string> = { bn: "bn-BD", en: "en-US" };

/* ── Utilities ─────────────────────────────────────────────────── */

/** Extract the first meaningful paragraph from MDX content for use as meta description */
export function extractDescription(content: string, maxLength = 160): string {
  // Remove frontmatter, headings, code blocks, image embeds, links, formatting
  const cleaned = content
    .replace(/---[\s\S]*?---/, "") // frontmatter
    .replace(/```[\s\S]*?```/g, "") // code blocks
    .replace(/#{1,6}\s+/g, "") // headings
    .replace(/!\[.*?\]\(.*?\)/g, "") // images
    .replace(/\[([^\]]*)\]\(.*?\)/g, "$1") // links → text
    .replace(/[*_~`]/g, "") // formatting
    .replace(/\n{2,}/g, "\n") // multiple newlines
    .trim();

  // Get first non-empty paragraph
  const paragraphs = cleaned.split(/\n+/).filter((p) => p.trim().length > 20);
  const firstPara = paragraphs[0]?.trim() || "";

  if (firstPara.length <= maxLength) return firstPara;
  return firstPara.slice(0, maxLength).replace(/\s+\S*$/, "") + "…";
}

/** Generate keywords from post title + tags + category + keyword clusters + global config */
export function extractKeywords(post: PostMeta, site: SiteConfig, content?: string): string {
  const parts: string[] = [];

  // 1. Primary Keyword: Post Title (Full Title & Cleaned Title)
  if (post.title) {
    parts.push(post.title.trim());
    const cleanTitle = post.title
      .replace(/\s*[-\|:]?\s*(পর্ব|part|chapter|পর্বঃ)\s*[-\|:]?\s*(\d+|[০-৯]+)/gi, "")
      .trim();
    if (cleanTitle && cleanTitle !== post.title.trim()) {
      parts.push(cleanTitle);
    }
  }

  // 2. Tags as keywords
  if (post.tags.length > 0) {
    parts.push(...post.tags);
  }

  // 3. Category name
  if (post.categoryName) {
    parts.push(post.categoryName);
  }

  // 4. Global keywords from config.json
  if (site.seo?.keywords) {
    parts.push(...site.seo.keywords.split(",").map((k) => k.trim()).filter(Boolean));
  }

  // 5. Keyword cluster matches from search.md
  const searchText = `${post.title} ${post.description} ${content || ""}`;
  const matches = findMatchingClusters(searchText, 2);
  if (matches.length > 0) {
    const keywordTag = generateKeywordsTag(matches);
    if (keywordTag) {
      parts.push(...keywordTag.split(", "));
    }
  }

  // Deduplicate and join
  return [...new Set(parts)].slice(0, 15).join(", ");
}

/** Clean text for meta tags (strip markdown, newlines, control characters, extra whitespace) */
export function cleanMetaText(text: string, maxLength = 200): string {
  if (!text) return "";
  const cleaned = text
    .replace(/---[\s\S]*?---/, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/#{1,6}\s+/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]*)\]\(.*?\)/g, "$1")
    .replace(/[*_~`\r]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength).replace(/\s+\S*$/, "") + "…";
}

/* ── Post metadata generator ───────────────────────────────────── */

export function generatePostMetadata(
  post: Post,
  site: SiteConfig,
  locale: Locale = DEFAULT_LOCALE,
  /**
   * Part number for this story, when several stories share a headline.
   *
   * See `buildPartIndexes` in lib/series-utils.ts. Without it, two
   * separately published stories with the same headline produced the same
   * <title>, and Google could only index one of them.
   */
  partIndex?: number,
): Metadata {
  const rawDescription = post.description || extractDescription(post.content);
  const identifier = post.uid || post.slug;
  const baseUrl = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  // Stories published after the public-slug rollout are canonical at
  // `/golpo/<public-slug>`; older ones keep their `/{uid}` URL.
  const storyPath = post.publicSlug
    ? `/golpo/${post.publicSlug}`
    : `/${identifier}`;
  const canonicalUrl =
    locale === "en" ? `${baseUrl}/en${storyPath}` : `${baseUrl}${storyPath}`;
  // Each story gets its own composed share card: post cover + 10% blur
  // + title/author/category text overlay, served by /api/og/post/[id].
  const imageUrl = toPostOgUrl(post, site);

  // Find keyword clusters for SEO enrichment
  const searchText = `${post.title} ${rawDescription} ${post.content?.slice(0, 500) || ""}`;
  const matches = findMatchingClusters(searchText, 2);

  // Disambiguate a headline shared by several stories before the keyword
  // engine gets a chance to append a phrase to it.
  const baseTitle =
    partIndex && partIndex > 1
      ? `${post.title} — পর্ব ${enToBnNumber(partIndex)}`
      : post.title;

  // Enrich title and description with keyword data
  const rawTitle = generateSeoTitle(baseTitle, matches);
  // The headline is not cut here. It used to be cut at 100 characters,
  // which chopped long story headlines mid-sentence — and the social
  // title was cut further still, because the brand suffix was appended
  // on top of the already-cut headline. The cap now only catches
  // pathological input.
  const seoTitle = cleanMetaText(rawTitle, 300);
  const seoDescription = cleanMetaText(generateSeoDescription(rawDescription, matches), 200);

  // The `<title>` is rendered through the root layout's template
  // (`%s — বাংলা চটি গল্প | Chotikahini`), but Next.js does NOT apply that
  // template to the OpenGraph or Twitter title. Without this, a shared
  // link showed a bare story headline while the search result showed the
  // headline plus the brand — two different titles for the same page.
  //
  // The social copy gets the *short* brand suffix rather than the full
  // template. The full suffix is 32 characters and platforms show only
  // about the first 60 characters of a card, so with the full suffix the
  // headline itself was pushed off the visible part of the card.
  //
  // The headline is sanitised *before* the suffix is added, so the
  // neutral filler word matches the headline's own language.
  const brandedTitle = socialBrandTitle(
    sanitizeTitleForSocial(seoTitle),
    site,
  );
  //
  // Social crawlers classify the card *text* as well as the card image,
  // so the `og:*` / `twitter:*` copies go through the social sanitiser.
  // The `<title>`, `<meta name="description">` and `<meta name="keywords">`
  // keep the full editorial text — those are what the site ranks for.
  //
  // The title uses `sanitizeTitleForSocial`, which replaces a removed
  // term with a neutral word instead of deleting it — deleting it left a
  // hole in the middle of the headline.
  const socialTitle = brandedTitle;
  const socialDescription = sanitizeForSocial(seoDescription);

  // Keyword-enriched tags
  const enrichedTags = generateTags(post.tags, matches);

  return {
    title: seoTitle,
    description: seoDescription,
    metadataBase: new URL(baseUrl),
    openGraph: {
      title: socialTitle,
      description: socialDescription,
      type: "article",
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
      authors: [post.authorName],
      images: imageUrl
        ? [
            {
              url: imageUrl,
              secureUrl: imageUrl.replace(/^http:/, "https:"),
              width: 1200,
              height: 630,
              alt: socialTitle,
              type: imageUrl.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg",
            },
          ]
        : [],
      url: canonicalUrl,
      siteName: site.seo?.siteName || site.title,
      locale: OG_LOCALE[locale],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description: socialDescription,
      images: imageUrl ? [imageUrl] : [],
      creator: normalizeTwitterHandle(site.seo?.twitterCreator),
    },
    alternates: {
      canonical: canonicalUrl,
      // Feed auto-discovery, so a reader that lands on a story page can
      // find the feed without being told its URL.
      types: {
        "application/rss+xml": `${baseUrl}/rss.xml`,
      },
    },
    keywords: extractKeywords(post, site, post.content),
    other: {
      // The site's honest content rating — it used to be hardcoded to
      // "general", which mislabelled an explicit-story site. Facebook's
      // classifier reads the rating, and a false "general" is what got
      // the share cards suppressed.
      rating: site.seo?.rating || "adult",
      ...(imageUrl
        ? {
            "og:image:secure_url": imageUrl.replace(/^http:/, "https:"),
            "og:image:width": "1200",
            "og:image:height": "630",
          }
        : {}),
      "article:published_time": post.publishedAt,
      "article:modified_time": post.updatedAt,
      "article:author": post.authorName,
      "article:section": post.categoryName,
      ...(enrichedTags.length > 0
        ? { "article:tag": enrichedTags.join(",") }
        : {}),
    },
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
  };
}

/* ── JSON-LD generators ────────────────────────────────────────── */

export interface JsonLdGraph {
  "@context": "https://schema.org";
  "@graph": Record<string, unknown>[];
}

export function generatePostJsonLd(
  post: Post,
  site: SiteConfig,
  breadcrumbItems?: { name: string; url: string }[],
  locale: Locale = DEFAULT_LOCALE,
  /**
   * Part number for this story, when several stories share a headline.
   * Keeps the structured-data headline identical to the <title>.
   */
  partIndex?: number,
): JsonLdGraph {
  const siteUrl = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  // Stories published after the public-slug rollout are canonical at
  // `/golpo/<public-slug>`; older ones keep their `/{uid}` URL.
  const storyPath = post.publicSlug
    ? `/golpo/${post.publicSlug}`
    : `/${post.uid || post.slug}`;
  const postUrl = locale === "en" ? `${siteUrl}/en${storyPath}` : `${siteUrl}${storyPath}`;
  const imageUrl = toPostOgUrl(post, site);
  const rawDescription = post.description || extractDescription(post.content);

  // Keyword enrichment
  const searchText = `${post.title} ${rawDescription} ${post.content?.slice(0, 500) || ""}`;
  const matches = findMatchingClusters(searchText, 2);
  const seoDescription = generateSeoDescription(rawDescription, matches);
  const baseTitle =
    partIndex && partIndex > 1
      ? `${post.title} — পর্ব ${enToBnNumber(partIndex)}`
      : post.title;
  const seoTitle = generateSeoTitle(baseTitle, matches);
  const jsonLdKeywords = generateJsonLdKeywords(matches);

  const graph: Record<string, unknown>[] = [];

  // 1. Website
  graph.push({
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    url: siteUrl,
    name: site.seo?.siteName || site.title,
    description: site.seo?.description || site.description,
    publisher: {
      "@id": `${siteUrl}/#organization`,
    },
    inLanguage: IN_LANGUAGE[locale],
  });

  // 2. Organization
  graph.push({
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    name: site.seo?.organization?.name || site.title,
    url: siteUrl,
    ...(site.logo
      ? {
          logo: {
            "@type": "ImageObject",
            url: `${siteUrl}${site.logo}`,
          },
        }
      : {}),
    ...(site.seo?.googleSearchConsole
      ? { sameAs: [site.seo.googleSearchConsole] }
      : {}),
  });

  // 3. Breadcrumb
  const homeLabel = locale === "en" ? "Home" : "হোম";
  const categoryUrl =
    locale === "en"
      ? `${siteUrl}/en/categories/${post.categoryId}`
      : `${siteUrl}/categories/${post.categoryId}`;
  const items = breadcrumbItems || [
    { name: homeLabel, url: locale === "en" ? `${siteUrl}/en` : siteUrl },
    { name: post.categoryName, url: categoryUrl },
    { name: post.title, url: postUrl },
  ];

  graph.push({
    "@type": "BreadcrumbList",
    "@id": `${postUrl}/#breadcrumb`,
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  });

  // 4. Article (with keyword-enriched headline & description)
  const article: Record<string, unknown> = {
    "@type": "Article",
    "@id": `${postUrl}/#article`,
    headline: seoTitle,
    description: seoDescription,
    url: postUrl,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    author: {
      "@type": "Person",
      "@id": `${siteUrl}/#author/${post.authorId}`,
      name: post.authorName,
      ...(post.authorImage
        ? { image: { "@type": "ImageObject", url: post.authorImage } }
        : {}),
    },
    publisher: {
      "@id": `${siteUrl}/#organization`,
    },
    // The composed share card, not the story's raw cover photo. The raw
    // cover is explicit imagery and was leaking into every structured
    // data payload; the composed card is a real 1200×630 JPEG that
    // actually matches the declared dimensions.
    image: imageUrl
      ? {
          "@type": "ImageObject",
          url: imageUrl.startsWith("http") ? imageUrl : `${siteUrl}${imageUrl}`,
          width: 1200,
          height: 630,
        }
      : undefined,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": postUrl,
    },
    keywords: [...new Set([post.title, post.categoryName, ...post.tags, jsonLdKeywords].filter(Boolean))].join(", "),
    articleSection: post.categoryName,
    inLanguage: IN_LANGUAGE[locale],
  };

  // Remove undefined values
  graph.push(Object.fromEntries(Object.entries(article).filter(([_, v]) => v !== undefined)));

  // 5. Author
  graph.push({
    "@type": "Person",
    "@id": `${siteUrl}/#author/${post.authorId}`,
    name: post.authorName,
    ...(post.authorBio ? { description: post.authorBio } : {}),
    ...(post.authorImage
      ? { image: { "@type": "ImageObject", url: post.authorImage } }
      : {}),
  });

  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

/**
 * Generate FAQPage JSON-LD for pages that answer common questions.
 * This uses keyword clusters to auto-generate relevant Q&A pairs.
 */
export function generateFaqJsonLd(
  questions: { question: string; answer: string }[],
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map((q) => ({
      "@type": "Question",
      name: q.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: q.answer,
      },
    })),
  };
}

/**
 * Generate BreadcrumbList JSON-LD for any page.
 */
export function generateBreadcrumbJsonLd(
  items: { name: string; url: string }[],
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/** Generate minimal JSON-LD for the home page / static pages */
export function generateSiteJsonLd(
  site: SiteConfig,
  locale: Locale = DEFAULT_LOCALE,
): JsonLdGraph {
  const siteUrl = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        url: locale === "en" ? `${siteUrl}/en` : siteUrl,
        name: site.seo?.siteName || site.title,
        description: site.seo?.description || site.description,
        publisher: {
          "@id": `${siteUrl}/#organization`,
        },
        inLanguage: IN_LANGUAGE[locale],
      },
      {
        "@type": "Organization",
        "@id": `${siteUrl}/#organization`,
        name: site.seo?.organization?.name || site.title,
        url: siteUrl,
        ...(site.logo
          ? {
              logo: {
                "@type": "ImageObject",
                url: `${siteUrl}${site.logo}`,
              },
            }
          : {}),
      },
    ],
  };
}
