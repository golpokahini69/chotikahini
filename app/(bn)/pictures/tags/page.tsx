import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shapes, Tag as TagIcon } from "lucide-react";
import { listPictureTags, listPictureCategories } from "@/lib/pictures";
import { pictureTagSlug } from "@/lib/picture-tag-utils";
import { isPictureSectionEnabled, getSiteConfig } from "@/lib/config";
import { buildListingMetadata } from "@/lib/metadata";
import { enToBnNumber } from "@/lib/utils";

// ISR budget: was 3600s. Vercel Hobby caps ISR writes at
// 200K/30d and this route was regenerating far too often. Publishes purge
// these paths on demand (revalidatePath), so the timer is only a fallback.
export const revalidate = 21600;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata(): Promise<Metadata> {
  if (!isPictureSectionEnabled()) {
    return { title: "ছবি পাওয়া যায়নি", robots: "noindex, nofollow" };
  }
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  return buildListingMetadata(
    "ছবির ট্যাগ ও ক্যাটাগরি",
    "সব ছবির গ্যালেরি ট্যাগ ও ক্যাটাগরির তালিকা — যেকোনো ট্যাগে ক্লিক করে সেই গ্যালেরিগুলো দেখুন",
    `${base}/pictures/tags`,
  );
}

/**
 * The full index of picture tags and categories.
 *
 * `/pictures` shows a short row of the most-used filters; this page
 * carries every one of them, so a tag used by a single gallery is still
 * reachable.
 */
export default async function PictureTagsPage() {
  if (!isPictureSectionEnabled()) notFound();

  const [tags, categories] = await Promise.all([
    listPictureTags().catch(() => []),
    listPictureCategories().catch(() => []),
  ]);

  return (
    <main className="container-page min-h-[70vh] py-6 sm:py-8">
      <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-fg sm:text-3xl">
        <TagIcon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
        ছবির ট্যাগ ও ক্যাটাগরি
      </h1>
      <p className="mt-1 max-w-prose text-sm leading-6 text-fg-muted">
        যেকোনো ট্যাগ বা ক্যাটাগরিতে ক্লিক করে সেই গ্যালেরিগুলো দেখুন।
      </p>

      {tags.length === 0 && categories.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-12 text-center">
          <p className="text-sm text-fg-muted">
            এখনো কোনো ট্যাগ বা ক্যাটাগরি নেই।
          </p>
        </div>
      ) : null}

      {tags.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-bold text-fg">
            ট্যাগ{" "}
            <span className="font-normal text-fg-subtle">
              ({enToBnNumber(tags.length)})
            </span>
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {tags.map((item) => (
              <li key={item.tag}>
                <Link
                  href={`/pictures/tag/${pictureTagSlug(item.tag)}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[12px] text-fg-muted transition hover:border-fg-muted hover:text-fg"
                >
                  <span className="font-latin">{item.tag}</span>
                  <span className="opacity-60">{enToBnNumber(item.count)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {categories.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-fg">
            <Shapes className="h-4 w-4 text-fg-subtle" />
            ক্যাটাগরি{" "}
            <span className="font-normal text-fg-subtle">
              ({enToBnNumber(categories.length)})
            </span>
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {categories.map((item) => (
              <li key={item.category}>
                <Link
                  href={`/pictures/category/${pictureTagSlug(item.category)}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[12px] text-fg-muted transition hover:border-fg-muted hover:text-fg"
                >
                  <span className="font-latin">{item.category}</span>
                  <span className="opacity-60">{enToBnNumber(item.count)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
