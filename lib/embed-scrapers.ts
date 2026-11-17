/**
 * lib/embed-scrapers.ts
 *
 * Provider-specific scrapers for embeds whose watch page is either
 * unreachable, geo-blocked, or carries no OpenGraph metadata.
 *
 * The pattern these sites use: the embed frame is a thin JS shell that calls
 * a player API with the real metadata inline:
 *
 *   html5player.setVideoTitle('Real Title');
 *   html5player.setVideoURL('/video.<slug>/<title-slug>');
 *   html5player.setThumbUrl('https://…/poster.jpg');
 *   html5player.setUploaderName('someone');
 *
 * We parse that out of the embed frame's HTML — no API key, no third-party
 * service, and it works even when the public watch page 404s.
 */

export interface ScrapedEmbed {
  title: string | null;
  sourceUrl: string | null;
  thumbnail: string | null;
  uploader: string | null;
  description: string | null;
}

/**
 * Decode the HTML entities providers embed inside their player JS strings.
 *
 * xvideos ships `html5player.setVideoTitle('Alia Bhatt&#039;s …')` — the
 * value is already inside a JS string, but still HTML-entity-escaped. The
 * old `readCall` only undid JS escapes (`\'`, `\/`), so the admin panel
 * showed the literal text `Alia Bhatt&#039;s` in the title field.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff
        ? String.fromCodePoint(n)
        : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => {
      const n = parseInt(code, 16);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff
        ? String.fromCodePoint(n)
        : "";
    })
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Pull a quoted JS string argument out of `setXxx('…')` calls. */
function readCall(html: string, fnNames: string[]): string | null {
  for (const name of fnNames) {
    // Matches `.setVideoTitle('…')` and `.setVideoTitle("…")`
    const re = new RegExp(
      `\\.${name}\\(\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)')\\s*\\)`,
      "i",
    );
    const m = html.match(re);
    const value = m ? (m[1] ?? m[2]) : null;
    if (value) {
      const decoded = decodeEntities(
        value
          .replace(/\\(['"\\])/g, "$1")
          .replace(/\\\//g, "/")
          .replace(/\\n/g, " ")
          .trim(),
      ).trim();
      if (decoded) return decoded;
    }
  }
  return null;
}

/** Humanise a URL slug: `desi_couple_chair_pe_ghodi` -> `Desi Couple Chair Pe Ghodi`. */
function humaniseSlug(slug: string): string | null {
  const parts = slug
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 1);
  if (parts.length < 2) return null;
  return parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Scrape the embed frame HTML for a provider's inline player metadata.
 * Returns null when the host isn't one we have a scraper for.
 */
export function scrapeEmbedFrame(
  embedUrl: string,
  html: string,
): ScrapedEmbed | null {
  let host: string;
  let origin: string;
  try {
    const u = new URL(embedUrl);
    host = u.hostname.replace(/^www\./, "").toLowerCase();
    origin = u.origin;
  } catch {
    return null;
  }

  const isXvideos =
    host === "xvideos.com" || host.endsWith(".xvideos.com") || host === "xvideos.link";
  const isXhamster =
    host.includes("xhamster") || host.includes("xhcdn");
  const isXnxx = host === "xnxx.com" || host.endsWith(".xnxx.com");

  if (!(isXvideos || isXhamster || isXnxx)) return null;

  const title =
    readCall(html, ["setVideoTitle", "setTitle", "setVideoName"]) ??
    (() => {
      const path = readCall(html, ["setVideoURL"]);
      if (!path) return null;
      const slug = path.split("/").filter(Boolean).pop();
      return slug ? humaniseSlug(slug) : null;
    })();

  const rawVideoPath = readCall(html, ["setVideoURL", "setVideoPath"]);
  let sourceUrl: string | null = null;
  if (rawVideoPath) {
    sourceUrl = rawVideoPath.startsWith("http")
      ? rawVideoPath
      : `${origin}${rawVideoPath.startsWith("/") ? "" : "/"}${rawVideoPath}`;
  }

  // Some players omit `setVideoURL` but still expose the bare video id.
  // XNXX's embed shell calls `setEncodedIdVideo('1acrq781')`; from that we can
  // rebuild the canonical watch page (`/video-<id>/_` redirects to the real one).
  if (!sourceUrl && isXnxx) {
    const encodedId = readCall(html, ["setEncodedIdVideo", "setVideoId"]);
    if (encodedId && /^[A-Za-z0-9]+$/.test(encodedId)) {
      sourceUrl = `https://www.xnxx.com/video-${encodedId}/_`;
    }
  }

  const thumbnail =
    readCall(html, ["setThumbUrl", "setPosterUrl", "setThumbnailUrl"]) ?? null;

  const uploader =
    readCall(html, ["setUploaderName", "setAuthorName", "setChannelName"]) ?? null;

  const description =
    readCall(html, ["setVideoDescription", "setDescription"]) ??
    (uploader && title
      ? `${title} — ${uploader}`
      : null);

  if (!title && !thumbnail && !sourceUrl) return null;

  return { title, sourceUrl, thumbnail, uploader, description };
}