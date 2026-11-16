"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export interface ViewerImage {
  url: string;
  thumb: string;
  width: number | null;
  height: number | null;
}

/**
 * Gallery grid + full-size lightbox.
 *
 * The grid is a dense mosaic with no gaps — the photos sit edge to edge so
 * the page reads as one continuous series, the way a provider gallery does.
 *
 * IMPORTANT — each tile keeps its OWN aspect ratio. A gallery mixes
 * portrait (1067×1600) and landscape (1600×1067) shots, so forcing every
 * tile into a fixed 3:4 box with `object-cover` crops the landscape photos
 * off at the waist. Instead we hand the browser the real width/height and
 * let it lay the tile out, and the mosaic is built with CSS *columns* so
 * mixed heights pack flush against each other instead of leaving ragged
 * gaps.
 *
 * Clicking a photo opens the lightbox:
 *   • ← / → arrow keys move between photos
 *   • Esc closes it
 *   • The background scroll is locked while it's open
 *   • A thumbnail strip at the bottom shows where you are
 *
 * Images are loaded straight from the provider's CDN with `unoptimized`,
 * so nothing passes through our server.
 */
export function PictureGalleryViewer({
  images,
  title,
}: {
  images: ViewerImage[];
  title: string;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const isOpen = openIndex !== null;

  const close = useCallback(() => setOpenIndex(null), []);

  const goPrev = useCallback(() => {
    setOpenIndex((current) =>
      current === null ? null : (current - 1 + images.length) % images.length,
    );
  }, [images.length]);

  const goNext = useCallback(() => {
    setOpenIndex((current) =>
      current === null ? null : (current + 1) % images.length,
    );
  }, [images.length]);

  // Keyboard controls + body scroll lock, active only while the lightbox
  // is open.
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
    };

    // Lock the page behind the overlay so the wheel doesn't scroll the
    // document while browsing photos.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, close, goPrev, goNext]);

  if (images.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-fg-muted">
        এই গ্যালারিতে কোনো ছবি পাওয়া যায়নি।
      </div>
    );
  }

  const current = openIndex === null ? null : images[openIndex];

  return (
    <>
      {/* ---- Mosaic: CSS columns, not grid ----
          A grid would make every ROW as tall as its tallest photo, so a
          landscape shot next to a tall portrait would sit in a stretched
          cell with a band of empty space under it — the mosaic reads as
          broken. CSS columns pack each photo flush against the next one,
          whatever its shape, which is how a provider gallery looks.

          The column count keeps each tile in a thumbnail range: on a wide
          desktop the content column is ~700px, so 4 columns land around
          170px per tile. Five columns would push tiles under ~140px and
          make the photos hard to actually see; the tile's `min-w` keeps
          them readable rather than letting a column collapse. */}
      <div className="columns-2 gap-0.5 sm:columns-3 lg:columns-4 [&>*]:mb-0.5">
        {images.map((image, index) => {
          const ratio = ratioFor(image);
          return (
            <button
              key={`${image.url}-${index}`}
              type="button"
              onClick={() => setOpenIndex(index)}
              className="group relative block w-full min-w-[110px] break-inside-avoid cursor-zoom-in overflow-hidden bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
              style={{ aspectRatio: ratio }}
              aria-label={`ছবি ${index + 1} বড় করে দেখুন`}
            >
              <Image
                src={image.thumb || image.url}
                alt={`${title} — ছবি ${index + 1}`}
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                unoptimized
                className="object-cover transition-opacity duration-200 group-hover:opacity-85"
              />
            </button>
          );
        })}
      </div>

      {/* ---- Lightbox ---- */}
      {isOpen && current ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${title} — ছবি ${openIndex + 1}`}
          className="fixed inset-0 z-[9999] flex flex-col bg-black/95"
          onClick={close}
        >
          {/* Close button */}
          <button
            type="button"
            onClick={close}
            aria-label="বন্ধ করুন"
            className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Counter */}
          <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-full bg-black/50 px-3 py-1.5 text-xs font-semibold tabular-nums text-white">
            {openIndex + 1} / {images.length}
          </div>

          {/* Prev / next — placed on the sides, above the image. */}
          {images.length > 1 ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  goPrev();
                }}
                aria-label="আগের ছবি"
                className="absolute left-2 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25 sm:left-4"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  goNext();
                }}
                aria-label="পরের ছবি"
                className="absolute right-2 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25 sm:right-4"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          ) : null}

          {/* The photo itself. Clicking the backdrop closes, clicking the
              image does not. */}
          <div
            className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={current.url}
              alt={`${title} — ছবি ${openIndex + 1}`}
              width={current.width || 1280}
              height={current.height || 1600}
              unoptimized
              className="max-h-full max-w-full object-contain"
              priority
            />
          </div>

          {/* Thumbnail strip */}
          {images.length > 1 ? (
            <div
              className="flex shrink-0 gap-1.5 overflow-x-auto border-t border-white/10 px-3 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {images.map((image, index) => (
                <button
                  key={`strip-${image.url}-${index}`}
                  type="button"
                  onClick={() => setOpenIndex(index)}
                  aria-label={`ছবি ${index + 1}-এ যান`}
                  aria-current={index === openIndex}
                  className={
                    "relative h-14 w-11 shrink-0 overflow-hidden rounded transition " +
                    (index === openIndex
                      ? "ring-2 ring-white"
                      : "opacity-50 hover:opacity-90")
                  }
                >
                  <Image
                    src={image.thumb || image.url}
                    alt={`${title} — ছবি ${index + 1}`}
                    fill
                    sizes="44px"
                    unoptimized
                    className="object-cover"
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * The photo's own aspect ratio, as a CSS value.
 *
 * We have the real pixel dimensions from the provider, so the tile can be
 * the shape of the actual photo rather than a guessed box. Portrait shots
 * stay tall, landscape shots stay wide — nothing gets cropped away.
 *
 * The width is capped so a very wide panorama can't blow the grid column
 * out, and a floor keeps absurd slivers from collapsing to nothing.
 */
function ratioFor(image: ViewerImage): string {
  const width = image.width && image.width > 0 ? image.width : null;
  const height = image.height && image.height > 0 ? image.height : null;
  if (!width || !height) return "3 / 4";
  const ratio = width / height;
  const capped = Math.min(Math.max(ratio, 0.5), 2);
  return `${capped}`;
}
