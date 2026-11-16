import type { Metadata } from "next";
import { getTagsData, tagsMetadata } from "@/lib/routes/tags";
import { TagsView } from "@/components/pages/TagsView";
import { JsonLd } from "@/components/JsonLd";
import { buildListingJsonLd } from "@/lib/jsonld";
import { getSiteConfig } from "@/lib/config";
import { tagSlug } from "@/lib/tag-utils";

/** Bangla tag cloud — `/tags`. */
export function generateMetadata(): Metadata {
  return tagsMetadata("bn");
}

export default async function TagsPage() {
  const data = await getTagsData();
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;

  // The tag cloud is the hub that links every `/tags/<slug>` page. Declaring
  // it as an ItemList tells Google those pages are real, and gives it a
  // single canonical place to crawl them from.
  const jsonLd = buildListingJsonLd({
    site,
    url: `${base}/tags`,
    name: "ট্যাগ",
    description: "সব ট্যাগের তালিকা",
    items: data.tags.map((t) => ({
      url: `${base}/tags/${tagSlug(t.tag)}`,
      name: `#${t.tag}`,
    })),
  });

  return (
    <>
      <JsonLd data={jsonLd} />
      <TagsView locale="bn" {...data} />
    </>
  );
}
