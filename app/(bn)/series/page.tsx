import type { Metadata } from "next";
import { getSeries } from "@/lib/posts";
import { getSeriesId, getSeriesTitle } from "@/lib/series-utils";
import { getSiteConfig } from "@/lib/config";
import { buildMetadata } from "@/lib/metadata";
import { enToBnNumber } from "@/lib/utils";
import { SeriesListView, type SeriesItem } from "@/components/pages/SeriesListView";
import { JsonLd } from "@/components/JsonLd";
import { buildListingJsonLd } from "@/lib/jsonld";

/**
 * Bangla series index — `/series`.
 *
 * The list is loaded on the server and rendered into the initial HTML. It
 * used to be a client component that fetched `/api/series` after mount, which
 * left the crawler with an empty page: no series names, no episode links,
 * and no way for it to discover the `/series/<id>` pages below.
 */
export const revalidate = 86400;

async function getSeriesItems(): Promise<SeriesItem[]> {
  try {
    const seriesList = await getSeries();
    return seriesList.map((series) => ({
      id: getSeriesId(series),
      title: getSeriesTitle(series),
      cover: series.find((post) => post.cover)?.cover || "",
      episodes: series.map((post) => ({
        slug: post.slug,
        uid: post.uid || post.slug,
        title: post.title,
        publishedAt: post.publishedAt,
        authorName: post.authorName,
      })),
    }));
  } catch (err) {
    console.error("[series] Failed to load series:", err);
    return [];
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  const items = await getSeriesItems();
  const episodeCount = items.reduce((sum, s) => sum + s.episodes.length, 0);

  const description =
    items.length > 0
      ? `আমাদের সব ধারাবাহিক চটি গল্প সিরিজ এক জায়গায় — মোট ${enToBnNumber(items.length)}টি সিরিজ, ${enToBnNumber(episodeCount)}টি পর্ব। পর্বগুলো ধারাবাহিকভাবে পড়ুন।`
      : `আমাদের ওয়েবসাইটের সকল ধারাবাহিক গল্প এবং সিরিজগুলো একসাথে পাওয়া যাবে। ${site.seo?.description || site.description}`;

  return buildMetadata({
    // The template already appends "— বাংলা চটি গল্প | Chotikahini",
    // so the inner title must not repeat "চটি গল্প" itself.
    title: `গল্পের সিরিজ — সব ধারাবাহিক অংশ`,
    description,
    url: `${base}/series`,
    skipKeywordTitle: true,
  });
}

export default async function SeriesPage() {
  const seriesList = await getSeriesItems();
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;

  const jsonLd = buildListingJsonLd({
    site,
    url: `${base}/series`,
    name: "গল্পের সিরিজ",
    description: "সব ধারাবাহিক চটি গল্প সিরিজ",
    items: seriesList.map((s) => ({
      url: `${base}/series/${s.id}`,
      name: s.title,
      image: s.cover || null,
    })),
  });

  return (
    <>
      <JsonLd data={jsonLd} />
      <SeriesListView seriesList={seriesList} />
    </>
  );
}
