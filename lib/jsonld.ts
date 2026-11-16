import type { SiteConfig } from "@/lib/config";

/**
 * Structured data for listing / taxonomy pages.
 *
 * Listing pages had **zero** JSON-LD blocks, which left Google with no
 * machine-readable way to understand what the page listed (stories, tags,
 * authors, galleries, …) or how the sections relate to each other. The
 * helpers below produce a compact `@graph` containing:
 *
 *  - `CollectionPage`   – the page itself
 *  - `ItemList`         – the entries shown on the page
 *  - `BreadcrumbList`   – the path from the homepage to this page
 *  - `WebPage`          – the page element inside the CollectionPage
 *
 * All of it is derived from data that is already rendered into the HTML,
 * so nothing here invents content that a visitor cannot see.
 */

export interface JsonLdEntry {
  /** Absolute URL of the listed item. */
  url: string;
  /** Visible name of the listed item. */
  name: string;
  /**
   * Optional image URL for the listed item.
   *
   * Deprecated — do not pass it. The only callers were feeding raw story
   * covers, gallery covers and scraped video poster frames into the
   * structured data. Those are explicit imagery, and the social
   * platforms' crawlers read the JSON-LD payload as well as the meta
   * tags, so a raw cover leaked here could suppress a card. The listing
   * image is omitted rather than replaced.
   */
  image?: string | null;
}

export interface ListingJsonLdInput {
  site: SiteConfig;
  /** Absolute URL of the listing page. */
  url: string;
  /** Visible heading of the listing page. */
  name: string;
  /** Meta description of the page. */
  description?: string;
  /** The items shown on this page. */
  items?: JsonLdEntry[];
  /**
   * Breadcrumb trail, excluding the homepage. The homepage is prepended
   * automatically so every breadcrumb starts from the root.
   */
  breadcrumb?: { name: string; url: string }[];
  /** Page number when the listing is paginated (1 = first page). */
  pageNumber?: number;
  /** Total number of pages in the listing. */
  totalPages?: number;
}

function baseUrlOf(site: SiteConfig): string {
  return site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
}

/**
 * Build a `@graph` of structured data for a listing page.
 */
export function buildListingJsonLd(input: ListingJsonLdInput): {
  "@context": "https://schema.org";
  "@graph": Record<string, unknown>[];
} {
  const { site, url, name, description, items = [], breadcrumb = [] } = input;
  const base = baseUrlOf(site);

  const graph: Record<string, unknown>[] = [];

  // 1. The collection page itself.
  graph.push({
    "@type": "CollectionPage",
    "@id": `${url}#collectionpage`,
    url,
    name,
    ...(description ? { description } : {}),
    isPartOf: { "@id": `${base}/#website` },
    inLanguage: "bn-BD",
    ...(input.pageNumber && input.pageNumber > 1
      ? {
          // Tells Google this is page N of a paginated listing.
          ...(input.totalPages
            ? {
                first: `${url.replace(/\/page\/\d+$/, "")}`,
                last: `${url.replace(/\/page\/\d+$/, "")}/page/${input.totalPages}`,
                next:
                  input.pageNumber < input.totalPages
                    ? `${url.replace(/\/page\/\d+$/, "")}/page/${input.pageNumber + 1}`
                    : undefined,
                prev:
                  input.pageNumber > 2
                    ? input.pageNumber === 2
                      ? `${url.replace(/\/page\/\d+$/, "")}`
                      : `${url.replace(/\/page\/\d+$/, "")}/page/${input.pageNumber - 1}`
                    : undefined,
              }
            : {}),
        }
      : {}),
  });

  // 2. The web page element (required by CollectionPage.mainEntity).
  graph.push({
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name,
    ...(description ? { description } : {}),
    isPartOf: { "@id": `${base}/#website` },
    about: { "@id": `${base}/#website` },
    inLanguage: "bn-BD",
  });

  // 3. The list of items.
  if (items.length > 0) {
    graph.push({
      "@type": "ItemList",
      "@id": `${url}#itemlist`,
      name,
      numberOfItems: items.length,
      itemListOrder: "https://schema.org/ItemListOrderDescending",
      itemListElement: items.map((item, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: item.name,
        url: item.url,
        // The item's image is deliberately omitted. It used to be the raw
        // story cover / gallery cover / video poster frame — explicit
        // imagery that leaked into every structured-data payload the
        // social crawlers read. Do not re-add it.
      })),
    });
  }

  // 4. Breadcrumbs — homepage first, then the supplied trail.
  const crumbs = [
    { name: "হোম", url: base },
    ...breadcrumb,
    { name, url },
  ];
  graph.push({
    "@type": "BreadcrumbList",
    "@id": `${url}#breadcrumb`,
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  });

  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

/**
 * Build a breadcrumb-only graph for a page that is not a collection
 * (e.g. `/about`, `/contact`, `/privacy`).
 */
export function buildPageJsonLd(input: {
  site: SiteConfig;
  url: string;
  name: string;
  description?: string;
  breadcrumb?: { name: string; url: string }[];
}): { "@context": "https://schema.org"; "@graph": Record<string, unknown>[] } {
  const { site, url, name, description, breadcrumb = [] } = input;
  const base = baseUrlOf(site);

  const crumbs = [
    { name: "হোম", url: base },
    ...breadcrumb,
    { name, url },
  ];

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name,
        ...(description ? { description } : {}),
        isPartOf: { "@id": `${base}/#website` },
        inLanguage: "bn-BD",
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: crumbs.map((c, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: c.name,
          item: c.url,
        })),
      },
    ],
  };
}
