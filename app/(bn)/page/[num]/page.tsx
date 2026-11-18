import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getPagedPostsData,
  getPagedPostsParams,
  isValidPagedPostsNum,
  pagedPostsMetadata,
} from "@/lib/routes/paged-posts";
import { PagedPostsView } from "@/components/pages/PagedPostsView";
import { JsonLd } from "@/components/JsonLd";
import { buildListingJsonLd } from "@/lib/jsonld";
import { getSiteConfig } from "@/lib/config";

/** Bangla paginated story listing — `/page/:num`. */
// ISR budget: was 3600s. Vercel Hobby caps ISR writes at
// 200K/30d and this route was regenerating far too often. Publishes purge
// these paths on demand (revalidatePath), so the timer is only a fallback.
export const revalidate = 21600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ num: string }>;
}): Promise<Metadata> {
  const { num } = await params;
  return pagedPostsMetadata("bn", num);
}

export async function generateStaticParams() {
  return getPagedPostsParams();
}

export default async function PagePage({ params }: { params: Promise<{ num: string }> }) {
  const { num } = await params;
  const data = await getPagedPostsData(num);
  // A page number past the end of the archive is not a page — return a real
  // 404 so Google does not index an empty, duplicate listing.
  if (!isValidPagedPostsNum(num, data.totalPages)) notFound();

  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  const pageNum = Number(num);

  const jsonLd = buildListingJsonLd({
    site,
    url: `${base}/page/${num}`,
    name: `পাতা ${pageNum} — সব লেখা`,
    description: `বাংলা চটি গল্পের সব লেখা — পাতা ${pageNum}`,
    pageNumber: pageNum,
    totalPages: data.totalPages,
    items: data.posts.map((p) => ({
      url: `${base}/${p.uid || p.slug}`,
      name: p.title,
      image: p.cover || null,
    })),
  });

  return (
    <>
      <JsonLd data={jsonLd} />
      <PagedPostsView locale="bn" {...data} />
    </>
  );
}
