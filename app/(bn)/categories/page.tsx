import type { Metadata } from "next";
import { getAllCategoryConfigs, getSiteConfig } from "@/lib/config";
import { getAllPostsAsync } from "@/lib/posts";
import { buildMetadata } from "@/lib/metadata";
import { JsonLd } from "@/components/JsonLd";
import { buildListingJsonLd } from "@/lib/jsonld";
import { enToBnNumber } from "@/lib/utils";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Category index — `/categories`.
 *
 * This page did not exist. Every category detail page linked to its
 * siblings but there was no hub listing them, so `/categories` returned a
 * 404 and the whole taxonomy was only reachable from the sidebar. It is
 * also the natural parent in the breadcrumb trail of every
 * `/categories/<id>` page.
 */
export const revalidate = 86400;

export function generateMetadata(): Metadata {
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  return buildMetadata({
    title: `ক্যাটাগরি — ${site.title}`,
    description: `সব ক্যাটাগরির লেখা এক জায়গায় — বিভাগ অনুযায়ী সব বাংলা চটি গল্প পড়ুন।`,
    url: `${base}/categories`,
    skipKeywordTitle: true,
  });
}

export default async function CategoriesPage() {
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  const categories = getAllCategoryConfigs();

  // Count stories per category so the index shows real, useful information
  // instead of an empty list of links.
  const posts = await getAllPostsAsync();
  const counts = new Map<string, number>();
  for (const p of posts) {
    const id = (p.categoryId || "").toLowerCase().trim();
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }

  // The JSON-LD ItemList only advertises categories that have content. A
  // category with zero stories is `noindex, follow` and is not in the
  // sitemap, so listing it here would contradict both signals.
  const items = categories
    .filter((c) => (counts.get(c.id.toLowerCase().trim()) || 0) > 0)
    .map((c) => ({
      url: `${base}/categories/${c.id}`,
      name: c.name,
    }));

  const jsonLd = buildListingJsonLd({
    site,
    url: `${base}/categories`,
    name: "ক্যাটাগরি",
    description: "সব ক্যাটাগরির তালিকা",
    items,
  });

  return (
    <div className="container-page py-10 sm:py-14">
      <JsonLd data={jsonLd} />

      <div className="flex items-center gap-2 mb-3">
        <span className="h-1 w-1 rounded-full bg-fg" />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
          ক্যাটাগরি
        </h2>
      </div>

      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg mb-2">
        সব ক্যাটাগরি
      </h1>
      <p className="text-sm text-fg-muted mb-8">
        বিভাগ অনুযায়ী সব বাংলা চটি গল্প খুঁজুন
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {categories
          .filter((c) => (counts.get(c.id.toLowerCase().trim()) || 0) > 0)
          .map((c) => {
          const count = counts.get(c.id.toLowerCase().trim()) || 0;
          return (
            <Link
              key={c.id}
              href={`/categories/${c.id}`}
              className="group flex flex-col rounded-2xl border border-border bg-surface p-5 transition-all duration-200 hover:bg-surface-hover hover:border-fg/30 hover:-translate-y-1 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-base font-semibold text-fg group-hover:text-fg">
                  {c.name}
                </h2>
                <ArrowRight className="h-4 w-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-1" />
              </div>
              {c.description && (
                <p className="mt-2 text-sm text-fg-muted leading-relaxed">
                  {c.description}
                </p>
              )}
              <p className="mt-3 text-xs text-fg-subtle">
                মোট {enToBnNumber(count)}টি লেখা
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
