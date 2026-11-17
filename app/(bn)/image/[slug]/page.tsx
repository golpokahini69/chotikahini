import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  Images,
  Layers,
  User,
  Eye,
} from "lucide-react";
import { buildMetadata } from "@/lib/metadata";
import { toMediaOgUrl } from "@/lib/og-urls";
import { getPublishedPictureBySlug } from "@/lib/pictures";
import { pictureTagSlug } from "@/lib/picture-tag-utils";
import { isPictureSectionEnabled } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PictureGalleryViewer } from "@/components/PictureGalleryViewer";
import { PictureViewTracker } from "@/components/PictureViewTracker";
import { LiveViewCount } from "@/components/LiveViewCount";
import { enToBnNumber, formatDateTime } from "@/lib/utils";

interface PicturesPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PicturesPageProps,
): Promise<Metadata> {
  // When the picture section is killed site-wide, every detail page is 404
  // — and so is the meta, so search engines see noindex and de-index.
  if (!isPictureSectionEnabled()) {
    return buildMetadata({ title: "ছবি পাওয়া যায়নি", robots: "noindex, nofollow" });
  }

  // The metadata pass must never be the thing that throws: if the gallery
  // query fails (table missing, network blip) the page render below will
  // surface a real 500, and a metadata crash here would only muddy that.
  // A lookup miss is still a genuine 404, so it keeps the noindex meta.
  let picture = null;
  try {
    const { slug } = await params;
    picture = await getPublishedPictureBySlug(slug);
  } catch {
    picture = null;
  }

  if (!picture) {
    return buildMetadata({ title: "ছবি পাওয়া যায়নি", robots: "noindex, nofollow" });
  }
  return buildMetadata({
    title: picture.title,
    description: picture.description || picture.title,
    url: `/image/${picture.public_slug}`,
    // The card is composed from the gallery's own cover, but the cover
    // never reaches the crawler directly — `/api/og/media/picture/…` blurs
    // it past recognition before it is composited. Passing the raw
    // `cover_url` here is what got the cards suppressed by the platforms'
    // adult-content classifiers.
    image: toMediaOgUrl(
      "picture",
      picture.id,
      picture.updated_at || picture.published_at,
    ),
  });
}

export default async function PicturePublicPage({ params }: PicturesPageProps) {
  if (!isPictureSectionEnabled()) notFound();

  const { slug } = await params;
  const picture = await getPublishedPictureBySlug(slug);
  if (!picture) notFound();

  const count = picture.image_count || picture.images?.length || 0;
  const published = picture.published_at
    ? formatDateTime(picture.published_at)
    : null;

  // `view_count` only exists once scripts/picture-views.sql has been run;
  // fall back to counting rows in picture_views so the number is never blank.
  let viewCount = picture.view_count ?? 0;
  if (!viewCount) {
    const { count: viewRows } = await getSupabaseAdmin()
      .from("picture_views")
      .select("id", { count: "exact", head: true })
      .eq("gallery_id", picture.id);
    viewCount = viewRows ?? 0;
  }

  return (
    <main className="min-h-[70vh] pb-16">
      {/* Counts THIS site's view of the gallery, de-duplicated per visitor
          per day by the API route. */}
      <PictureViewTracker galleryId={picture.id} />

      <div className="container-page pt-4 sm:pt-6">
        <Link
          href="/pictures"
          className="mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-fg-muted transition hover:bg-surface-hover hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" />
          সব ছবি
        </Link>
      </div>

      {/* Two-column on desktop — the mosaic on the left, the gallery facts
          on the right. On mobile it stacks: title, then mosaic, then facts. */}
      <div className="container-page grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* ---------- Primary column: title + mosaic ---------- */}
        <div className="min-w-0">
          <div className="mb-5">
            {picture.model_name ? (
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-alt text-fg-muted">
                  <User className="h-4 w-4" />
                </span>
                <span className="font-latin text-[15px] font-semibold text-fg lg:text-base">
                  {picture.model_name}
                </span>
              </div>
            ) : null}

            <h1 className="mt-2 font-latin text-2xl font-bold leading-snug tracking-tight text-fg sm:text-[28px] lg:text-[32px]">
              {picture.title}
            </h1>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-muted">
              {count > 0 ? (
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <Images className="h-3.5 w-3.5" />
                  {enToBnNumber(count)}টি ছবি
                </span>
              ) : null}
              <LiveViewCount storageKey={`picture:${picture.id}`} initial={viewCount} />
              {published ? (
                <>
                  <span aria-hidden className="text-border/80">
                    ·
                  </span>
                  <span>{published}</span>
                </>
              ) : null}
            </div>
          </div>

          {/* ---- The gallery itself ---- */}
          <PictureGalleryViewer images={picture.images} title={picture.title} />
        </div>

        {/* ---------- Sidebar: gallery facts ---------- */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="space-y-5 rounded-2xl border border-border bg-surface-alt/40 p-5">
            <h2 className="text-sm font-bold text-fg">গ্যালারির তথ্য</h2>

            {picture.description ? (
              <p className="font-latin text-[13px] leading-6 text-fg-muted">
                {picture.description}
              </p>
            ) : null}

            <a
              href={picture.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center gap-2 rounded-full bg-surface-alt px-4 text-sm font-semibold text-fg transition hover:bg-surface-hover"
            >
              <Images className="h-4 w-4" />
              মূল সাইটে দেখুন
              <ExternalLink className="h-3.5 w-3.5 opacity-60" />
            </a>

            {picture.channel_name ? (
              <div>
                <p className="mb-1.5 text-[13px] font-semibold text-fg">চ্যানেল</p>
                <p className="flex items-center gap-1.5 text-[13px] text-fg-muted">
                  <Layers className="h-3.5 w-3.5" />
                  <span className="font-latin font-semibold text-fg">
                    {picture.channel_name}
                  </span>
                </p>
              </div>
            ) : null}

            {picture.categories && picture.categories.length > 0 ? (
              <TagRow
                label="ক্যাটাগরি"
                items={picture.categories}
                hrefFor={(item) =>
                  `/pictures/category/${pictureTagSlug(item)}`
                }
              />
            ) : null}

            {picture.tags && picture.tags.length > 0 ? (
              <TagRow
                label="ট্যাগ"
                items={picture.tags}
                hrefFor={(item) => `/pictures/tag/${pictureTagSlug(item)}`}
              />
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
}

/** A labelled row of clickable pill-shaped tags. */
function TagRow({
  label,
  items,
  hrefFor,
}: {
  label: string;
  items: string[];
  hrefFor: (item: string) => string;
}) {
  return (
    <div>
      <p className="mb-2 text-[13px] font-semibold text-fg">{label}</p>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li key={item}>
            <Link
              href={hrefFor(item)}
              className="inline-block rounded-full border border-border px-2.5 py-1 text-[12px] text-fg-muted transition hover:border-fg-muted hover:text-fg"
            >
              {item}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
