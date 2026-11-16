import Link from "next/link";
import Image from "next/image";
import { Images } from "lucide-react";
import { enToBnNumber, timeAgoBn } from "@/lib/utils";

export interface PictureCardData {
  id: string;
  /**
   * The readable public slug — e.g. "kutir-chobi". Null for galleries
   * published before public slugs existed; those keep their old
   * /pictures/<uuid> URL.
   */
  publicSlug?: string | null;
  title: string;
  coverUrl: string;
  imageCount: number;
  modelName?: string | null;
  channelName?: string | null;
  publishedAt?: string | null;
  /**
   * OUR site's view count for this gallery — how many unique visitors
   * opened it here. Deliberately NOT the provider's own counter.
   */
  viewCount?: number | null;
}

/**
 * The public URL of a picture gallery.
 *
 * Galleries published after the public-slug rollout live at
 * `/image/<public-slug>`; older ones keep `/pictures/<uuid>`.
 *
 * Both spellings of the slug field are accepted. The card data uses
 * `publicSlug` (camelCase), but a raw row straight from the database
 * carries `public_slug` — and passing one of those rows here used to
 * silently fall through to the legacy URL, advertising a redirect
 * target instead of the canonical address.
 */
export function pictureHref(picture: {
  id: string;
  publicSlug?: string | null;
  public_slug?: string | null;
}) {
  const slug = picture.publicSlug || picture.public_slug;
  return slug
    ? `/image/${slug}`
    : `/pictures/${picture.id}`;
}

/**
 * Grid card for /pictures and the paginated list.
 *
 * Layout follows the dense thumbnail-index pattern the video section uses —
 * no card border, no card background, the cover tile IS the visual:
 *
 *   [ 3:4 cover ]
 *   title, clamped to 2 lines
 *   model · photo count · time ago
 *
 * ── Alignment rules ──────────────────────────────────────────────
 * The cover and the text block are two separate boxes inside one grid
 * cell, and they must line up:
 *
 *   • The cover fills the full cell width, so the image's left and right
 *     edges ARE the column's edges. No horizontal padding is applied to
 *     the cover — padding it would inset the image inside the column and
 *     make neighbouring columns look ragged.
 *   • The text is indented by a small, FIXED amount (not a percentage)
 *     so every column's text starts on the same optical line.
 *   • The title block is a fixed height of two lines. Titles vary between
 *     one and two lines; without a fixed height the shorter title's meta
 *     row rides up and the row of cards ends up with a ragged baseline.
 *     The clamp keeps the text, the fixed height keeps the alignment.
 *
 * The image is rendered straight from the provider's CDN with
 * `unoptimized` — nothing is proxied through our server, so the photo
 * streams from the provider with zero egress cost.
 */
export function PictureCard({
  picture,
  sizes = "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 300px",
  priority = false,
  coverClassName = "",
  compact = false,
}: {
  picture: PictureCardData;
  sizes?: string;
  priority?: boolean;
  /** Extra classes on the cover box — used to bound its size per surface. */
  coverClassName?: string;
  /** Shrink the type to match a small cover (the /pictures grid). */
  compact?: boolean;
}) {
  const ago = timeAgoBn(picture.publishedAt);

  return (
    <Link
      href={pictureHref(picture)}
      className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      {/* ---- Cover: full-bleed within the column ----
          The cover is a fixed 3:4 box, so every card in the grid is the
          same shape and the rows line up.

          `min-w-[110px]` is the floor — the cover never shrinks below a
          readable thumbnail, even in the narrowest column. The max-width
          is supplied per surface via `coverClassName`, because the list
          page and the homepage rail want different ceilings. */}
      <div
        className={`relative aspect-[3/4] min-w-[110px] overflow-hidden bg-surface-alt ${coverClassName}`}
      >
        <Image
          src={picture.coverUrl}
          alt={picture.title || "ছবির গ্যালারি"}
          fill
          sizes={sizes}
          priority={priority}
          unoptimized
          className="object-cover transition-opacity duration-200 group-hover:opacity-90"
        />

        {/* Centred gallery glyph — ALWAYS visible, the same affordance idea
            as the video card's play button. Without it the tile reads as a
            single photo, and on touch devices there is no hover to reveal
            that it opens a whole series. */}
        {picture.imageCount > 1 ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span
              className={
                compact
                  ? "flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-white/25"
                  : "flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-white/25"
              }
            >
              <Images className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
            </span>
          </span>
        ) : null}

        {/* Photo-count badge — bottom-right, tabular so the numbers align. */}
        {picture.imageCount > 0 ? (
          <span
            className={
              compact
                ? "absolute bottom-1 right-1 rounded bg-black/75 px-1 py-px text-[10px] font-semibold leading-4 tabular-nums text-white"
                : "absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-px text-[11px] font-semibold leading-4 tabular-nums text-white"
            }
          >
            {enToBnNumber(picture.imageCount)}টি
          </span>
        ) : null}
      </div>

      {/* ---- Text block: fixed indents + a fixed two-line title height ----
          In `compact` mode (the /pictures grid) the cover is a small
          thumbnail, so the type scales down with it — a 17px title under a
          220px cover looks oversized and swallows the card. In normal mode
          (the homepage rail) the type keeps its larger size. */}
      <div className="px-2 pt-2 font-latin">
        {/* H2, not H3: the gallery grid sits directly under the page H1,
            so an H3 here would skip a level in the outline. */}
        <h2
          className={
            compact
              ? "line-clamp-2 h-[2.4em] text-[13px] font-semibold leading-[1.3] text-fg lg:text-[14px]"
              : "line-clamp-2 h-[2.6em] text-[15px] font-semibold leading-[1.3] text-fg lg:text-[17px]"
          }
        >
          {picture.title}
        </h2>

        <div
          className={
            compact
              ? "mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-[1.4] text-fg-muted"
              : "mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] leading-[1.4] text-fg-muted lg:text-[13px]"
          }
        >
          {picture.modelName ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Images
                className={
                  compact
                    ? "h-2.5 w-2.5 shrink-0 opacity-70"
                    : "h-3 w-3 shrink-0 opacity-70"
                }
              />
              <span className="truncate">{picture.modelName}</span>
            </span>
          ) : null}
          {picture.viewCount ? (
            <>
              <span aria-hidden className="text-border/80">
                ·
              </span>
              <span className="tabular-nums text-fg-subtle">
                {enToBnNumber(picture.viewCount)} ভিউ
              </span>
            </>
          ) : null}
          {ago ? (
            <>
              <span aria-hidden className="text-border/80">
                ·
              </span>
              <span className="text-fg-subtle">{ago}</span>
            </>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
