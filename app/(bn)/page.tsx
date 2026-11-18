import type { Metadata } from "next";
import { homeMetadata, getHomeData } from "@/lib/routes/home";
import { HomeView } from "@/components/pages/HomeView";
import { JsonLd } from "@/components/JsonLd";
import { buildListingJsonLd } from "@/lib/jsonld";
import { getSiteConfig } from "@/lib/config";

/**
 * Bangla homepage — `/`.
 *
 * The page logic lives in `lib/routes/home.ts` and the markup in
 * `components/pages/HomeView.tsx`.
 */
// ISR budget: was 3600s. Vercel Hobby caps ISR writes at
// 200K/30d and this route was regenerating far too often. Publishes purge
// these paths on demand (revalidatePath), so the timer is only a fallback.
export const revalidate = 21600;

export function generateMetadata(): Metadata {
  return homeMetadata("bn");
}

export default async function HomePage() {
  const data = await getHomeData();
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;

  // Structured data for the homepage listing. The homepage is the root of
  // the site's internal link graph, so declaring it as a `CollectionPage`
  // with an `ItemList` tells Google exactly which stories it anchors.
  const jsonLd = buildListingJsonLd({
    site,
    url: base,
    name: site.seo?.defaultTitle || site.title,
    description: site.seo?.description || site.description,
    items: data.latest.map((p) => ({
      url: `${base}/${p.uid || p.slug}`,
      name: p.title,
      image: p.cover || null,
    })),
  });

  return (
    <>
      <JsonLd data={jsonLd} />
      <HomeView locale="bn" {...data} />
    </>
  );
}
