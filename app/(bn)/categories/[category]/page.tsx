import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  categoryMetadata,
  getCategoryData,
  getCategoryParams,
} from "@/lib/routes/category";
import { CategoryView } from "@/components/pages/CategoryView";
import { JsonLd } from "@/components/JsonLd";
import { buildListingJsonLd } from "@/lib/jsonld";
import { getSiteConfig } from "@/lib/config";
import { localizeCategoryName } from "@/lib/i18n/overrides";

/** Bangla category listing — `/categories/:category`. */
export const revalidate = 86400;

export function generateStaticParams() {
  return getCategoryParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  return categoryMetadata("bn", category);
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const data = await getCategoryData(category);
  if (data.posts.length === 0 && !data.category) notFound();

  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  const name = localizeCategoryName(
    data.category?.id || category,
    data.category?.name,
    "bn",
  );

  const jsonLd = buildListingJsonLd({
    site,
    url: `${base}/categories/${category}`,
    name,
    description: data.category?.description || `${name} বিভাগের সকল লেখা`,
    items: data.posts.map((p) => ({
      url: `${base}/${p.uid || p.slug}`,
      name: p.title,
      image: p.cover || null,
    })),
    breadcrumb: [{ name: "ক্যাটাগরি", url: `${base}/categories` }],
  });

  return (
    <>
      <JsonLd data={jsonLd} />
      <CategoryView locale="bn" {...data} />
    </>
  );
}
