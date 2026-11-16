import { enToBnNumber } from '@/lib/utils';
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPostsByTag, getAllTags } from "@/lib/posts";
import { PostGridWithAds } from "@/components/PostGridWithAds";
import { getSiteConfig } from "@/lib/config";
import { buildListingMetadata } from "@/lib/metadata";
import { tagSlug, tagFromSlug } from "@/lib/tag-utils";
import { JsonLd } from "@/components/JsonLd";
import { buildListingJsonLd } from "@/lib/jsonld";

interface Props {
  params: Promise<{ tag: string }>;
}

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tag: tagSlugParam } = await params;
  const tag = tagFromSlug(tagSlugParam);
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  const title = `#${tag}`;
  const description = `"${tag}" ট্যাগযুক্ত সকল ${getSiteConfig().description || getSiteConfig().seo?.description}`;
  return buildListingMetadata(title, description, `${base}/tags/${tagSlugParam}`);
}

export default async function TagPage({ params }: Props) {
  const { tag: tagSlugParam } = await params;
  const tag = tagFromSlug(tagSlugParam);

  // A tag that exists on no story is not a page — it is a URL the crawler
  // invented. Returning 200 here produced a "soft 404": the page looked
  // empty, the status said "fine", and Google indexed an unbounded number
  // of worthless /tags/<garbage> URLs. Real 404 + the noindex robots meta
  // tells Google to drop it instead.
  const allTags = await getAllTags();
  const needle = tag.toLowerCase().trim().normalize("NFC");
  const known = allTags.some(
    (t) => t.tag.toLowerCase().trim().normalize("NFC") === needle,
  );
  if (!known) notFound();

  const posts = await getPostsByTag(tag);
  if (posts.length === 0) notFound();

  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;

  const jsonLd = buildListingJsonLd({
    site,
    url: `${base}/tags/${tagSlugParam}`,
    name: `#${tag}`,
    description: `"${tag}" ট্যাগযুক্ত সকল লেখা`,
    items: posts.map((p) => ({
      url: `${base}/${p.uid || p.slug}`,
      name: p.title,
      image: p.cover || null,
    })),
    breadcrumb: [{ name: "ট্যাগ", url: `${base}/tags` }],
  });

  return (
    <div className="container-page py-10 sm:py-14">
      <JsonLd data={jsonLd} />
      <div className="flex items-center gap-2 mb-3">
        <span className="h-1 w-1 rounded-full bg-fg" />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
          ট্যাগ
        </h2>
      </div>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg mb-1">
        #{tag}
      </h1>
      <p className="text-sm text-fg-muted mb-8">
        মোট {enToBnNumber(posts.length)}টি লেখা
      </p>

      <PostGridWithAds posts={posts} adInterval={4} />
    </div>
  );
}
