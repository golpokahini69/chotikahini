import type { Metadata } from "next";
import { getAllTags } from "@/lib/posts";
import { getSiteConfig } from "@/lib/config";
import { buildMetadata } from "@/lib/metadata";
import type { Locale } from "@/lib/i18n/locale";

/** Data for the tag cloud. */
export async function getTagsData() {
  const tags = await getAllTags();
  return { tags };
}

/** Metadata for the tag cloud page. */
export function tagsMetadata(locale: Locale): Metadata {
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;

  return buildMetadata({
    title:
      locale === "en"
        ? `Tags — ${site.title}`
        : `ট্যাগ — ${site.title}`,
    description:
      locale === "en"
        ? `${site.seo?.description || site.description} — tag cloud`
        : `${site.seo?.description || site.description} — ট্যাগ ক্লাউড`,
    url: locale === "en" ? `${base}/en/tags` : `${base}/tags`,
    locale,
    skipKeywordTitle: true,
  });
}
