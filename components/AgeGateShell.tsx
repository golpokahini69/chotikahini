"use client";

import { useEffect, useState } from "react";
import { AgeGateway } from "./AgeGateway";

// ── Search-engine crawler detection ──────────────────────────
// Bot user-agent patterns (case-insensitive substring match).
//
// This check runs on the CLIENT rather than in the root layout. It
// previously read the `user-agent` request header server-side, which
// made `headers()` a dynamic API — every page of the site was then
// server-rendered on demand instead of being served from the static /
// ISR cache. On a serverless host that is a per-request CPU cost on the
// hottest routes.
//
// The age gate is a client-side overlay anyway, so deciding whether to
// show it in the browser produces the same result without making the
// whole site dynamic.
const BOT_PATTERNS = [
  "googlebot", "bingbot", "slurp", "duckduckbot", "baiduspider",
  "yandexbot", "facebot", "facebookexternalhit", "twitterbot",
  "whatsapp", "linkedinbot", "pinterest",
  "applebot", "google-structured-data-testing-tool",
  "w3c_validator", "ia_archiver", "archive.org_bot",
  "semrushbot", "ahrefsbot", "majestic-12", "rogerbot",
  "dotbot", "gptbot", "bot", "crawler", "spider",
  // RSS feed readers. Their fetchers follow the feed's <link> to read
  // the story, and the age-gate overlay covers the whole page — so the
  // story was never readable and the feed looked broken. None of these
  // agents contain "bot"/"crawler"/"spider", so they used to hit the
  // gate like a normal visitor.
  "feedly", "feedbin", "freshrss", "newsblur", "inoreader",
  "tinytinyrss", "tiny tiny rss", "superfeedr", "feedwrangler",
  "theoldreader", "rssbot", "netvibes", "newsbeuter", "rssowl",
  "miniflux", "feedbro", "bazqux", "readkit", "rss reader",
  "feeddler", "feedhopper", "wordpress feed", "bloglines",
];

/**
 * Renders the 18+ age-gate overlay for human visitors.
 *
 * Crawlers are detected from the user agent so that search engines see
 * the real content and can index it.
 */
export function AgeGateShell() {
  const [showAgeGate, setShowAgeGate] = useState<boolean | null>(null);

  useEffect(() => {
    const ua = (navigator.userAgent || "").toLowerCase();
    const isBot = BOT_PATTERNS.some((p) => ua.includes(p));
    setShowAgeGate(!isBot);
  }, []);

  // `null` = not decided yet, or a crawler: render nothing so the page
  // content is never hidden behind the overlay.
  if (showAgeGate === false) return null;

  return <AgeGateway />;
}
