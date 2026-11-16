"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PictureCard, type PictureCardData } from "@/components/PictureCard";

/**
 * Horizontal scroll rail for picture cards.
 *
 * Mirrors `VideoScrollRail` — one row, fixed card width, native
 * `overflow-x-auto` swipe plus optional arrow navigation.
 *
 * Why a rail and not a grid: picture covers are PORTRAIT (3:4). A grid of
 * them is extremely tall — two half-width cards alone push ~700px down the
 * homepage, and a 4-up grid below them another ~350px. On a homepage the
 * picture module must read as a *teaser*, not a second library page. A
 * single rail of small portrait tiles is one row tall on every breakpoint,
 * so the module costs the page one band instead of three.
 *
 * Arrows only appear when there is actually something to scroll in that
 * direction, so the control never shows as a dead button.
 */
export function PictureScrollRail({
  pictures,
  sizes = "(max-width: 640px) 40vw, (max-width: 1024px) 28vw, 18vw",
  priorityFirst = false,
}: {
  pictures: PictureCardData[];
  sizes?: string;
  priorityFirst?: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < maxScroll - 4);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateArrows();
    el.scrollLeft = 0;
    el.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      window.removeEventListener("resize", updateArrows);
    };
  }, [updateArrows, pictures.length]);

  const scrollBy = useCallback((dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    // Advance one card + gap so the rail creeps card by card instead of
    // jumping a whole viewport. The card width is viewport-relative, so
    // measure the live first child rather than hardcoding pixels.
    const first = el.firstElementChild as HTMLElement | null;
    const cardStep = first ? first.offsetWidth : Math.round(el.clientWidth * 0.8);
    const gap = parseFloat(getComputedStyle(el).columnGap || "0") || 0;
    el.scrollBy({ left: dir * (cardStep + gap), behavior: "smooth" });
  }, []);

  if (pictures.length === 0) return null;

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2 [scrollbar-width:none] sm:gap-3 [&::-webkit-scrollbar]:hidden"
      >
        {pictures.map((picture, i) => (
          <div
            key={picture.id}
            className="w-[42vw] shrink-0 snap-start sm:w-[30vw] md:w-[22vw] lg:w-[16vw] xl:w-[13.5vw]"
          >
            <PictureCard
              picture={picture}
              sizes={sizes}
              priority={priorityFirst && i === 0}
              coverClassName="mx-auto w-full max-w-[190px]"
              compact
            />
          </div>
        ))}
        {/* Trailing spacer so the last card can snap flush to the left edge. */}
        <div aria-hidden className="w-1 shrink-0" />
      </div>

      {canLeft ? (
        <RailArrow side="left" onClick={() => scrollBy(-1)} />
      ) : null}
      {canRight ? (
        <RailArrow side="right" onClick={() => scrollBy(1)} />
      ) : null}
    </div>
  );
}

function RailArrow({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  const isLeft = side === "left";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isLeft ? "আগের ছবিগুলো দেখুন" : "পরের ছবিগুলো দেখুন"}
      className={
        "absolute top-1/3 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full " +
        "border border-border bg-surface/95 text-fg shadow-md backdrop-blur transition " +
        "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 " +
        "md:flex " +
        (isLeft ? "left-1" : "right-1")
      }
    >
      {isLeft ? (
        <ChevronLeft className="h-5 w-5" />
      ) : (
        <ChevronRight className="h-5 w-5" />
      )}
    </button>
  );
}
