// ─────────────────────────────────────────────────────────────
// lib/picture-scraper.ts — parse a provider gallery page.
//
// The picture section works exactly like the video section: the admin pastes
// a gallery URL and the server scrapes everything it needs (every image URL,
// the title, the model, the tags) so nothing has to be typed by hand.
//
// Images are NEVER downloaded. We only keep the provider's CDN URLs and the
// browser streams each image straight from the CDN.
//
// Server-only. No dependencies.
//
// ── Providers ────────────────────────────────────────────────
// Each supported provider has its own page shape, so each gets its own
// parser. `parseGallery` picks the right one from the URL.
//
// PORNPICS — the original provider:
//   <ul id="tiles">
//     <li class="thumbwook">
//       <a class="rel-link" href='<CDN>/1280/.../x.jpg'
//          data-pswp-width='1067' data-pswp-height='1600'>
//   <div class="gallery-info__item"><span class="gallery-info__title">Channel:</span>
//     <a href="/channels/playboy-plus/">Playboy Plus</a>
//   <div class="gallery-info__item"><span class="gallery-info__title">Models:</span>
//     <a href="/pornstars/becky-wunder/"><span>Becky Wunder</span></a>
//   <div class="gallery-info__item tags"><span class="gallery-info__title">Categories:</span>
//     <a href='/beautiful/'><span>Beautiful</span></a>…
//   <div class="gallery-info__item tags"><span class="gallery-info__title">Tags:</span>
//     <a href='/tags/hot-blonde/'><span>Hot Blonde</span></a>…
//
// BABEHUB — a WordPress site, a completely different shape:
//   <ul class="list-gallery static css" data-title="Club Sweethearts">
//     <li style="--w: 400; --h: 573;">
//       <a data-fancybox="images" data-srcset="…_1200.jpg 1200w, …_800.jpg 800w"
//          href="…_1200.jpg" data-width="1200" data-height="1793">
//         <img src="…_w400.jpg" srcset="…_w800.jpg 800w, …_w600.jpg 600w, …">
//   <a class="overlay-b" href="/channel/club-sweethearts/">Club Sweethearts</a>
//   <a class="overlay-b" href="/model/marketa-b/">Marketa</a>
//   <a href="/tag/cute/" class="visible-tag">Cute</a>…
//
//   The `<a href>` is the full-size file (`_1200`), the `<img src>` is the
//   thumbnail (`_w400`), and `data-width`/`data-height` carry the real pixel
//   dimensions. Babehub's view counter is loaded over AJAX, so the count is
//   left null rather than guessed.
// ─────────────────────────────────────────────────────────────

export interface ScrapedGalleryImage {
  /** Full-size image URL (the provider's largest published resolution). */
  url: string;
  /** Thumbnail URL — same path, smaller size segment. */
  thumb: string;
  width: number | null;
  height: number | null;
}

export interface ScrapedGallery {
  title: string | null;
  description: string | null;
  sourceUrl: string;
  coverUrl: string | null;
  images: ScrapedGalleryImage[];
  modelName: string | null;
  channelName: string | null;
  categories: string[];
  tags: string[];
  sourceViews: number | null;
}

/**
 * Hosts we are willing to fetch a gallery page from.
 *
 * An empty list means "any public host" — the admin can paste a gallery
 * link from any site. The SSRF deny-list in `isBlockedHost` still applies
 * (private IP ranges, localhost, link-local), so allowing every public
 * host does not open the server to internal-network requests.
 *
 * Entries here are an optional narrowing: add a host to opt it out of the
 * generic parser if a site ever needs to be blocked outright.
 */
const ALLOWED_HOST_SUFFIXES: string[] = [];

/**
 * Provider hosts that get a dedicated, more accurate parser.
 *
 * These are matched by suffix; anything else falls through to the generic
 * parser, which reads any gallery page's image list.
 */
const KNOWN_PROVIDER_SUFFIXES = [
  ".pornpics.com",
  "pornpics.com",
  ".babehub.com",
  "babehub.com",
  ".elitebabes.com",
  "elitebabes.com",
  ".femjoyhunter.com",
  "femjoyhunter.com",
  ".babesource.com",
  "babesource.com",
  ".pornchat.com",
  "pornchat.com",
];

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 1_500_000;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

/**
 * Hosts we must never fetch from — the usual SSRF deny-list. A public
 * gallery provider can never live on these, so anything that redirects
 * there is rejected.
 */
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.startsWith("169.254.") ||
    h.startsWith("10.") ||
    h.startsWith("192.168.")
  );
}

/**
 * Is this host allowed to be scraped?
 *
 * Any public host is allowed — the admin may paste a gallery link from
 * any site. The SSRF deny-list (`isBlockedHost`) is what actually protects
 * the server: private IP ranges, localhost and link-local addresses are
 * rejected before we ever make the request.
 *
 * `ALLOWED_HOST_SUFFIXES` can narrow this to a known list if needed.
 */
export function isAllowedGalleryHost(host: string): boolean {
  const h = host.toLowerCase();
  if (isBlockedHost(h)) return false;
  if (ALLOWED_HOST_SUFFIXES.length === 0) return true;
  return ALLOWED_HOST_SUFFIXES.some((suffix) =>
    suffix.startsWith(".") ? h.endsWith(suffix) : h === suffix,
  );
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value: string): string {
  return decodeEntities(
    value
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/**
 * Why a gallery page could not be fetched.
 *
 * The admin sees a different message for each, because the fix differs:
 * a typo needs a corrected link, a Cloudflare challenge needs a different
 * site, and a timeout needs patience.
 */
export type GalleryFetchError =
  | "invalid-url"
  | "blocked-host"
  | "timeout"
  | "forbidden"
  | "challenge"
  | "http-error"
  | "network-error";

export interface GalleryFetchResult {
  html: string | null;
  error: GalleryFetchError | null;
  status: number | null;
}

/**
 * Fetch the gallery page HTML.
 *
 * Returns the reason for a failure as well as the page itself, so the API
 * can tell the admin what actually went wrong instead of a generic
 * "couldn't fetch it".
 */
export async function fetchGalleryHtmlDetailed(
  url: string,
): Promise<GalleryFetchResult> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { html: null, error: "invalid-url", status: null };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { html: null, error: "invalid-url", status: null };
  }
  if (isBlockedHost(target.hostname)) {
    return { html: null, error: "blocked-host", status: null };
  }
  if (!isAllowedGalleryHost(target.hostname)) {
    return { html: null, error: "blocked-host", status: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(target.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
      },
    });

    if (!res.ok) {
      // Cloudflare (and similar bot walls) answer with 403 plus a
      // challenge page. This is not a broken link — the site simply
      // refuses a plain server-side fetch — so it gets its own message.
      const mitigated = res.headers.get("cf-mitigated");
      if (res.status === 403 && mitigated === "challenge") {
        return { html: null, error: "challenge", status: 403 };
      }
      if (res.status === 403 || res.status === 401) {
        return { html: null, error: "forbidden", status: res.status };
      }
      return { html: null, error: "http-error", status: res.status };
    }

    const buf = await res.arrayBuffer();
    const html = new TextDecoder("utf-8", { fatal: false }).decode(
      buf.slice(0, MAX_HTML_BYTES),
    );

    // A challenge page sometimes answers 200 with the interstitial body.
    // Detect it so we don't report "no pictures found" for a page we were
    // never allowed to read.
    if (looksLikeChallengePage(html)) {
      return { html: null, error: "challenge", status: res.status };
    }

    return { html, error: null, status: res.status };
  } catch (err) {
    const aborted =
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError");
    return {
      html: null,
      error: aborted ? "timeout" : "network-error",
      status: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Does this HTML look like a bot-challenge / "please wait" interstitial?
 *
 * Cloudflare injects its `challenge-platform` JavaScript-detection script
 * into EVERY page it fronts — including the ones that served us the full
 * content. So that script alone proves nothing; the reliable markers are
 * the interstitial's own title ("Just a moment...") and its "please enable
 * JavaScript and cookies" body.
 *
 * Getting this wrong is not academic: a false positive would tell the
 * admin that a perfectly good gallery cannot be read.
 */
function looksLikeChallengePage(html: string): boolean {
  // A real page is never tiny — if we got real content it is long.
  if (html.length > 200_000) return false;

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const justAMoment = /^\s*just a moment/i.test(title);
  const needsJs = /enable javascript and cookies to continue/i.test(html);
  const cfChallenge = /__cf_chl|cf_chl_opt|_cf_chl\b/i.test(html);

  // The interstitial itself: the title and/or the call to enable JS,
  // together with one of Cloudflare's challenge markers.
  return (justAMoment || needsJs) && (cfChallenge || justAMoment || needsJs);
}

/**
 * Fetch the gallery page HTML, or null if it could not be fetched.
 *
 * A thin wrapper over `fetchGalleryHtmlDetailed` for callers that do not
 * care why the fetch failed.
 */
export async function fetchGalleryHtml(url: string): Promise<string | null> {
  const result = await fetchGalleryHtmlDetailed(url);
  return result.html;
}

/**
 * Build the thumbnail URL from the full-size URL.
 *
 * The provider serves the same file under two size segments:
 *   .../1280/7/188/10648923/10648923_001_ebe1.jpg   ← full size
 *   .../460/7/188/10648923/10648923_001_ebe1.jpg    ← thumbnail
 * The path suffix is identical, so only the size segment changes.
 *
 * When the URL doesn't follow that shape we fall back to the full-size URL
 * for both — a larger thumbnail still renders correctly.
 */
function toThumbnailUrl(fullUrl: string): string {
  return fullUrl.replace(/\/(1280|1920|2048|3000)\//, "/460/");
}

/**
 * Extract every image in the gallery.
 *
 * Each gallery tile is an `<a>` whose `href` points at the full-size file and
 * whose `data-pswp-width` / `data-pswp-height` carry the real pixel
 * dimensions (used to reserve the right aspect ratio in the grid).
 */
function extractImages(html: string): ScrapedGalleryImage[] {
  const images: ScrapedGalleryImage[] = [];
  const seen = new Set<string>();

  // Anchor inside a gallery tile: href is the full-size image, and the
  // pswp data attributes carry the dimensions.
  //
  // The attribute string is captured whole (`<a\b([^>]*)>`) and the href is
  // then read from it with its own pattern. Matching the href inline (as in
  // `<a\b[^>]*\bhref=…>`) is greedy — `[^>]*` swallows the href before the
  // pattern gets to it, so the anchor silently fails to match.
  const re = /<a\b([^>]*)>/gi;

  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const attrs = match[1] || "";

    const hrefMatch = attrs.match(
      /\bhref\s*=\s*(['"])(https?:\/\/[^'"]+?\.(?:jpg|jpeg|png|webp))\1/i,
    );
    if (!hrefMatch) continue;

    const url = hrefMatch[2];

    // Only count anchors that live in the gallery tile list — the page also
    // links to a few unrelated images (logo, placeholder, ads).
    const before = html.slice(Math.max(0, match.index - 400), match.index);
    if (!/class\s*=\s*['"][^'"]*thumbwook/i.test(before)) continue;

    if (seen.has(url)) continue;
    seen.add(url);

    const widthMatch = attrs.match(/data-pswp-width\s*=\s*['"]?(\d+)/i);
    const heightMatch = attrs.match(/data-pswp-height\s*=\s*['"]?(\d+)/i);

    images.push({
      url,
      thumb: toThumbnailUrl(url),
      width: widthMatch ? Number(widthMatch[1]) : null,
      height: heightMatch ? Number(heightMatch[1]) : null,
    });
  }

  return images;
}

/** Pull the human-readable name out of an anchor's inner text. */
function anchorText(html: string, anchorHtml: string): string | null {
  const inner = anchorHtml.match(/>([\s\S]*?)<\//)?.[1];
  const text = stripTags(inner ?? "");
  return text || null;
}

/**
 * The model (performer) name — the first `/pornstars/...` link on the page.
 *
 * The link may be relative (`/pornstars/…`) or absolute
 * (`https://www.pornpics.com/pornstars/…`), so both are accepted.
 */
function extractModelName(html: string): string | null {
  const re =
    /<a\b[^>]*href\s*=\s*(['"])(?:https?:\/\/(?:www\.)?pornpics\.com)?\/pornstars\/[^'"]+\1[^>]*>([\s\S]*?)<\/a>/i;
  const m = html.match(re);
  if (!m) return null;
  const text = stripTags(m[2]);
  return text || null;
}

/** The channel / studio name — the first `/channels/...` link on the page. */
function extractChannelName(html: string): string | null {
  const re =
    /<a\b[^>]*href\s*=\s*(['"])(?:https?:\/\/(?:www\.)?pornpics\.com)?\/channels\/[^'"]+\1[^>]*>([\s\S]*?)<\/a>/i;
  const m = html.match(re);
  if (!m) return null;
  const text = stripTags(m[2]);
  return text || null;
}

/**
 * Categories and tags.
 *
 * Both live in a `.gallery-info__item.tags` block and both use the same
 * anchor markup, so they can only be told apart by the block's own label
 * ("Categories:" vs "Tags:"). We therefore walk the info blocks in order
 * and read the label that precedes each anchor list.
 */
function extractCategoriesAndTags(html: string): {
  categories: string[];
  tags: string[];
} {
  const categories: string[] = [];
  const tags: string[] = [];

  // Each info block: `gallery-info__title` holds the label, the anchors
  // that follow inside the same block hold the values.
  const blockRe =
    /<div\b[^>]*class\s*=\s*['"][^'"]*gallery-info__item[^'"]*['"][^>]*>([\s\S]*?)(?=<div\b[^>]*class\s*=\s*['"][^'"]*gallery-info__item|<\/div>\s*<\/div>)/gi;

  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(html)) !== null) {
    const inner = block[1] || "";
    // The label may carry a trailing `&nbsp;` (e.g. "Channel:&nbsp;"), so
    // the entities are decoded *before* the colon is stripped — otherwise
    // the colon stays glued to the label and never matches.
    const label = stripTags(
      inner.match(/gallery-info__title[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "",
    )
      .replace(/[:\s]+$/, "")
      .trim()
      .toLowerCase();

    if (label !== "categories" && label !== "tags") continue;

    const bucket = label === "categories" ? categories : tags;
    const anchorRe = /<a\b[^>]*href\s*=\s*(['"])[^'"]+\1[^>]*>([\s\S]*?)<\/a>/gi;
    let anchor: RegExpExecArray | null;
    while ((anchor = anchorRe.exec(inner)) !== null) {
      const text = stripTags(anchor[2]);
      if (!text) continue;
      // The "Suggest" control is an <a>/<span> pair with no label text.
      if (text.length > 60) continue;
      if (!bucket.includes(text)) bucket.push(text);
    }
  }

  return { categories, tags };
}

/**
 * The provider's own view counter.
 *
 * It lives in a dedicated `<span class="info-views">Views: 349,106</span>`.
 * The generic "… views …" pattern is used as a fallback, but it is anchored
 * so it can't match unrelated numbers (the page also lists ratings and
 * photo counts).
 */
function extractViews(html: string): number | null {
  const scoped =
    html.match(/class\s*=\s*['"][^'"]*info-views[^'"]*['"][^>]*>([\s\S]*?)<\//i)?.[1] ??
    html.match(/([\d][\d,]{2,})\s*views?\b/i)?.[1];
  if (!scoped) return null;

  const digits = scoped.replace(/[^\d]/g, "");
  if (!digits) return null;
  const value = Number(digits);
  return Number.isFinite(value) ? value : null;
}

/** The gallery title — the `<title>` element minus the site's own suffix. */
function extractTitle(html: string): string | null {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (!raw) return null;
  const cleaned = decodeEntities(raw).replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  // Drop the provider's trailing brand: "… - PornPics.com"
  const withoutBrand = cleaned.replace(/\s*[-–—|]\s*PornPics\.com\s*$/i, "").trim();
  return withoutBrand || cleaned;
}

/** The meta description, trimmed of the provider's SEO boilerplate tail. */
function extractDescription(html: string): string | null {
  const raw =
    html.match(
      /<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["']/i,
    )?.[1] ??
    html.match(
      /<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["']/i,
    )?.[1];
  if (!raw) return null;

  let text = decodeEntities(raw).replace(/\s+/g, " ").trim();
  // "Watch 16 pics of X at PornPics.com. Browse more FREE porn pictures…"
  // → keep only the first sentence, minus the "at PornPics.com" tail.
  text = text.replace(/\s+at\s+PornPics\.com\.?.*$/i, "").trim();
  text = text.replace(/\s+Browse more FREE.*$/i, "").trim();
  return text || null;
}

/**
 * Parse a gallery page into its images + metadata.
 *
 * `sourceUrl` is echoed back so the caller always stores the canonical URL
 * it was given rather than one we guessed.
 */
export function parseGallery(
  html: string,
  sourceUrl: string,
): ScrapedGallery {
  const gallery = parseGalleryRaw(html, sourceUrl);
  return dedupeGallery(gallery);
}

/**
 * The identity of an image, ignoring the size.
 *
 * A gallery's files are published at several sizes, and the two common
 * conventions are:
 *
 *   • in the FILENAME — `photo-01_w400.jpg` vs `photo-01_w1200.jpg`
 *   • in the PATH     — `…/460/7/188/10648923/x.jpg` vs `…/1280/…/x.jpg`
 *
 * To collapse those into one entry we strip the size from both. The trap:
 * a naive "strip trailing digits" also removes the photo's own serial
 * number, so `photo-01.jpg` and `photo-02.jpg` would collapse into one and
 * the gallery would show a single image. A size is therefore only stripped
 * when it is unmistakably a size — an explicit marker in the filename, or
 * a well-known size segment in the path — never a bare number.
 */
function imageStem(identityUrl: string): string {
  const file = identityUrl.split("/").pop() || identityUrl;
  const ext = file.match(/\.(?:jpe?g|png|webp|gif|avif)$/i)?.[0] ?? "";
  const base = ext ? file.slice(0, -ext.length) : file;

  // An explicitly marked size: `_w400`, `_thumb400`, `_large`, `_full`.
  const marked = base.replace(
    /[_\-](?:w|thumb|small|medium|large|full|orig|original)\d{2,4}$/i,
    "",
  );
  if (marked !== base) return marked.toLowerCase();

  // No size marker — the filename is the photo's own identity, serial
  // number included.
  return base.toLowerCase();
}

/**
 * The directory part of an image's identity, with any size segment
 * removed.
 *
 * PornPics publishes `…/460/…/x.jpg` (thumbnail) and `…/1280/…/x.jpg`
 * (full size) — the same file at two paths. Without normalising the size
 * segment out of the directory, the two look like different images and the
 * gallery ends up with 32 entries instead of 16.
 *
 * Only a segment that is purely a known pixel size is treated as a size;
 * a segment like `188` (a folder name) is left alone.
 */
function imageDir(identityUrl: string): string {
  const file = identityUrl.split("/").pop() || identityUrl;
  const dir = identityUrl.slice(0, identityUrl.length - file.length);
  // Known thumbnail/full-size segment widths. `188` is deliberately absent
  // — it is a real folder in PornPics' layout, not a size.
  return dir
    .replace(/\/(?:320|360|400|460|540|640|720|800|1024|1080|1200|1280|1600|1920|2048|3000)(?=\/)/g, "")
    // PornChat serves the same photo under a named variant folder —
    // `…/galleries/full/…` and `…/galleries/new_small/…`. These are
    // sizes of one image, not two images.
    .replace(
      /\/(?:full|new_small|new_big|small|big|medium|large|original|thumb|thumbnail)(?=\/)/g,
      "",
    )
    .toLowerCase();
}

/**
 * Remove duplicate images from a parsed gallery.
 *
 * Two levels of identity:
 *   • the exact URL (query string ignored) — the same file listed twice.
 *   • the directory + filename stem — the same photo published at two
 *     sizes (`x_w400.jpg` and `x_1200.jpg`).
 *
 * The first occurrence wins, so the gallery keeps its original order.
 */
function dedupeGallery(gallery: ScrapedGallery): ScrapedGallery {
  const seenUrls = new Set<string>();
  const seenStems = new Set<string>();
  const images: ScrapedGalleryImage[] = [];

  for (const image of gallery.images) {
    const url = image.url.split("#")[0].split("?")[0].toLowerCase();
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    const file = url.split("/").pop() || url;
    const dir = imageDir(url);
    const key = `${dir}::${imageStem(url)}`;
    if (seenStems.has(key)) continue;
    seenStems.add(key);

    images.push(image);
  }

  return { ...gallery, images, coverUrl: images[0]?.url ?? gallery.coverUrl };
}

function parseGalleryRaw(
  html: string,
  sourceUrl: string,
): ScrapedGallery {
  // ---- 1. The "masonry" gallery platform ----
  // Detected from the markup, so ANY site on this theme is recognised
  // without a code change. It gives the most accurate result: full-size
  // URL, thumbnail URL, and real pixel dimensions for every photo.
  const platform = platformHostFor(sourceUrl);
  if (platform && looksLikePlatformGallery(html)) {
    const result = parsePlatformGallery(html, sourceUrl, platform);
    if (result.images.length > 0) return result;
  }

  // ---- 2. PornPics ----
  // Has a dedicated parser for its own markup.
  if (isKnownProviderHost(sourceUrl)) {
    const images = extractImages(html);
    const { categories, tags } = extractCategoriesAndTags(html);

    const result: ScrapedGallery = {
      title: extractTitle(html),
      description: extractDescription(html),
      sourceUrl,
      coverUrl: images[0]?.url ?? null,
      images,
      modelName: extractModelName(html),
      channelName: extractChannelName(html),
      categories,
      tags,
      sourceViews: extractViews(html),
    };

    // The dedicated parser is more accurate, but if the site's markup ever
    // changes under it, the generic parser is a better answer than "no
    // images found".
    if (result.images.length > 0) return result;
  }

  // ---- 2b. BabeSource ----
  // Its own markup: a run of `slideshowGalleryImage` anchors. Detected by
  // that class so a lookalike site on the same CMS still works.
  if (looksLikeBabeSourceGallery(html)) {
    const result = parseBabeSourceGallery(html, sourceUrl);
    if (result.images.length > 0) return result;
  }

  // ---- 2c. PornChat ----
  // Its own markup: a `.gallery` container whose photos are
  // `<a class="picture">` anchors. The full-size path is in the anchor's
  // `href`; `data-fullpath`/`data-smallpath` hold the variant folders.
  if (looksLikePornChatGallery(html)) {
    const result = parsePornChatGallery(html, sourceUrl);
    if (result.images.length > 0) return result;
  }

  // ---- 3. Any other site ----
  return parseGenericGallery(html, sourceUrl);
}

/** Is this one of the providers that has a hand-written parser? */
function isKnownProviderHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return KNOWN_PROVIDER_SUFFIXES.some((suffix) =>
      suffix.startsWith(".") ? host.endsWith(suffix) : host === suffix,
    );
  } catch {
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════
   BABEHUB / ELITEBABES
   ══════════════════════════════════════════════════════════════ */

/**
 * Babehub, Elitebabes and Femjoyhunter run the SAME gallery platform
 * (WordPress + the "masonry" theme), so one parser handles all of them. The
 * only differences are cosmetic: the brand word in the `<title>`, and
 * whether the studio link is `/channel/…` (Babehub) or carried by the
 * gallery's `data-title` (all three).
 *
 * The platform is detected from the MARKUP, not from a host list — a new
 * site on the same theme is recognised without a code change.
 */
type PlatformHost = string;

/**
 * Does this page use the "masonry" gallery platform?
 *
 * The signature is a `<ul class="list-gallery">` holding `<li>`s whose
 * anchors point straight at the full-size file and carry `data-width` /
 * `data-height`. That combination is what the platform parser reads.
 */
function looksLikePlatformGallery(html: string): boolean {
  if (!/class\s*=\s*["'][^"']*\blist-gallery\b/i.test(html)) return false;
  return (
    /<a\b[^>]*\bhref\s*=\s*["'][^"']+\.(?:jpe?g|png|webp)[^"']*["'][^>]*\bdata-width\s*=/i.test(
      html,
    ) || /<li\b[^>]*style\s*=\s*["'][^"']*--w\s*:/i.test(html)
  );
}

/**
 * The host label for the platform parser.
 *
 * We use the page's own hostname so the model/channel/tag regexes can be
 * anchored to it, but the *brand* word in the `<title>` is read from the
 * title itself rather than guessed.
 */
function platformHostFor(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Platform gallery images (Babehub / Elitebabes).
 *
 * The gallery is a `<ul class="list-gallery …">` whose `<li>`s each hold an
 * anchor (the full-size file) wrapping an `<img>` (the thumbnail):
 *
 *   <li style="--w: 400; --h: 573;">
 *     <a data-fancybox="images" href="…_1200.jpg"
 *        data-width="1200" data-height="1793">
 *       <img src="…_w400.jpg" … />
 *
 * So the full URL comes from the anchor's `href`, the thumbnail from the
 * image's `src`, and the real dimensions from the anchor's data attributes.
 * Only anchors inside the *first* `list-gallery` list are taken — the page
 * also renders two related-gallery sliders with the same markup, and those
 * are other sets, not this one.
 */
function extractPlatformImages(html: string): ScrapedGalleryImage[] {
  const images: ScrapedGalleryImage[] = [];
  const seen = new Set<string>();

  // The gallery list itself.
  const listMatch = html.match(
    /<ul\b[^>]*class\s*=\s*['"][^'"]*list-gallery[^'"]*['"][^>]*>([\s\S]*?)<\/ul>/i,
  );
  const listHtml = listMatch?.[1] ?? "";
  if (!listHtml) return images;

  // The anchor's `href` points at the full-size file; the `<img>` inside it
  // carries the thumbnail.
  //
  // The attribute capture is written carefully: `<a\b([^>]*)>` grabs the
  // whole attribute string, and the href is then read from THAT string with
  // its own pattern. Matching the href inline (as in
  // `<a\b[^>]*href=…>`) is greedy — `[^>]*` swallows the href before the
  // pattern gets to it, so the anchor never matches. This two-step form
  // works regardless of where `href` sits in the attribute list.
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = re.exec(listHtml)) !== null) {
    const attrs = match[1] || "";
    const inner = match[2] || "";

    const hrefMatch = attrs.match(
      /\bhref\s*=\s*(['"])(https?:\/\/[^'"]+?\.(?:jpg|jpeg|png|webp))\1/i,
    );
    if (!hrefMatch) continue;

    const url = hrefMatch[2];

    if (seen.has(url)) continue;
    seen.add(url);

    const widthMatch = attrs.match(/data-width\s*=\s*['"]?(\d+)/i);
    const heightMatch = attrs.match(/data-height\s*=\s*['"]?(\d+)/i);

    // The thumbnail is the <img src> inside this anchor. WordPress emits a
    // `_w400` variant there; if it's missing we fall back to the full-size
    // URL, which still renders — just heavier.
    const thumbMatch = inner.match(
      /<img\b[^>]*\bsrc\s*=\s*(['"])(https?:\/\/[^'"]+?\.(?:jpg|jpeg|png|webp))\1/i,
    );
    const thumb = thumbMatch?.[2] ?? url;

    images.push({
      url,
      thumb,
      width: widthMatch ? Number(widthMatch[1]) : null,
      height: heightMatch ? Number(heightMatch[1]) : null,
    });
  }

  return images;
}

/**
 * The platform's model name — the `/model/...` link.
 *
 * The path segment is what identifies it; the host is left open so a site
 * on this theme is recognised wherever it lives. We take the FIRST match
 * with text — later `/model/` links on the page are the "more from this
 * model" strip, which have no anchor text.
 */
function extractPlatformModel(html: string, _host: PlatformHost): string | null {
  const re =
    /<a\b[^>]*href\s*=\s*(['"])[^'"]*\/model\/[^'"]+\1[^>]*>([\s\S]*?)<\/a>/gi;

  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = stripTags(m[2]);
    if (text && text.length <= 120) return text;
  }
  return null;
}

/**
 * The platform's channel / studio name.
 *
 * Babehub's page carries two different `/channel/` links: a broad
 * distribution channel ("Adult Prime") and the set this gallery belongs to
 * ("Club Sweethearts"). The gallery's own `<ul class="list-gallery">`
 * carries `data-title` with the set name, and the `<h1>` agrees with it —
 * so that is the authoritative value for *this* gallery. The `/channel/`
 * link is only a fallback.
 *
 * Elitebabes and Femjoyhunter have no `/channel/` path at all; their
 * `data-title` ("Metart", "Femjoy") is the studio, which is the same
 * value we want.
 */
function extractPlatformChannel(
  html: string,
  _host: PlatformHost,
): string | null {
  const fromGallery = html.match(
    /<ul\b[^>]*class\s*=\s*['"][^'"]*list-gallery[^'"]*['"][^>]*data-title\s*=\s*(['"])([^'"]+)\1/i,
  )?.[2];
  if (fromGallery) {
    const text = stripTags(fromGallery);
    if (text) return text;
  }

  const m = html.match(
    /<a\b[^>]*href\s*=\s*(['"])[^'"]*\/channel\/[^'"]+\1[^>]*>([\s\S]*?)<\/a>/i,
  );
  if (!m) return null;
  return stripTags(m[2]) || null;
}

/**
 * The platform's tags.
 *
 * Every tag is an anchor to `/tag/<slug>/`, rendered either as a
 * `visible-tag` or a `hidden-tag` (the second half, revealed by the
 * "+ All Tags" toggle). We want both sets, so we match on the URL rather
 * than the class.
 *
 * The platform has no separate "category" concept — the whole tag list is
 * stored as `tags`, and `categories` stays empty.
 */
function extractPlatformTags(html: string, _host: PlatformHost): string[] {
  const tags: string[] = [];
  const re =
    /<a\b[^>]*href\s*=\s*(['"])[^'"]*\/tag\/[^'"]+\1[^>]*>([\s\S]*?)<\/a>/gi;

  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = stripTags(m[2]);
    if (!text || text.length > 60) continue;
    if (!tags.includes(text)) tags.push(text);
  }
  return tags;
}

/**
 * The platform's title.
 *
 * The `<title>` reads "Marketa Nude in  - Free Club Sweethearts Picture
 * Gallery at Babehub" — the model's name, then the set, then the site's
 * own boilerplate. The `<h1>` ("Marketa in Club Sweethearts set") is far
 * cleaner, so we prefer it and fall back to a cleaned `<title>`.
 */
function extractPlatformTitle(html: string, _host: PlatformHost): string | null {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const fromH1 = h1 ? stripTags(h1) : "";
  if (fromH1) return fromH1;

  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (!raw) return null;
  const cleaned = decodeEntities(raw).replace(/\s+/g, " ").trim();
  // The platform's `<title>` ends with the site's own name
  // ("… at Babehub", "… at Femjoy Hunter"). We can't hard-code that word
  // for every site on the theme, so we drop the trailing segment after the
  // last separator instead — the part before it is the gallery's own title.
  const withoutBrand = cleaned
    .replace(/\s*[-–—|]\s*Free\b.*$/i, "")
    .replace(/\s*[-–—|]\s*\S[^-|]{0,30}$/i, "")
    .trim();
  return withoutBrand || cleaned;
}

/** The platform's meta description, minus the trailing "Free picture Gallery…" tail. */
function extractPlatformDescription(html: string): string | null {
  const raw =
    html.match(
      /<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["']/i,
    )?.[1] ??
    html.match(
      /<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["']/i,
    )?.[1];
  if (!raw) return null;

  const text = decodeEntities(raw).replace(/\s+/g, " ").trim();
  const trimmed = text.replace(/\s*[-–—]\s*Free picture Gallery.*$/i, "").trim();
  return trimmed || null;
}

/** Assemble the platform result (Babehub / Elitebabes). */
function parsePlatformGallery(
  html: string,
  sourceUrl: string,
  host: PlatformHost,
): ScrapedGallery {
  const images = extractPlatformImages(html);
  return {
    title: extractPlatformTitle(html, host),
    description: extractPlatformDescription(html),
    sourceUrl,
    coverUrl: images[0]?.url ?? null,
    images,
    modelName: extractPlatformModel(html, host),
    channelName: extractPlatformChannel(html, host),
    categories: [],
    tags: extractPlatformTags(html, host),
    // The view counter is rendered by an AJAX script, so there is no number
    // in the HTML to read. We leave it null rather than invent one.
    sourceViews: null,
  };
}

/* ══════════════════════════════════════════════════════════════
   PORNCHAT
   ══════════════════════════════════════════════════════════════ */

/**
 * Does this page use PornChat's gallery markup?
 *
 * The signature is the `picture` class on the anchors that wrap each
 * photo, together with the `data-fullpath` / `data-smallpath` variant
 * folders PornChat publishes the gallery under.
 */
function looksLikePornChatGallery(html: string): boolean {
  return (
    /<a\b[^>]*class\s*=\s*["'][^"']*\bpicture\b[^"']*["']/i.test(html) &&
    /data-fullpath\s*=/i.test(html)
  );
}

/**
 * PornChat's gallery markup.
 *
 *   <a class="picture" id="index_0" data-index="0"
 *      data-fullpath="https://data.multi.pornchat.com/datas/galleries/full/<hash>/"
 *      data-smallpath="https://data.multi.pornchat.com/datas/galleries/new_small/<hash>/"
 *      data-id="1117645" data-pic="0"
 *      href="https://data.multi.pornchat.com/datas/galleries/full/<hash>/0.jpg?secure=…">
 *
 * The `href` is already the full-size file and `data-smallpath` is the
 * thumbnail folder — the thumbnail URL is the small path with the
 * picture's own index appended, which is the filename the anchor's href
 * ends with.
 *
 * Metadata is thin on this page: the `<title>` carries the gallery's own
 * name, and the tags are a plain comma-separated line ("milf, open pussy,
 * solo") rather than links.
 */
function parsePornChatGallery(
  html: string,
  sourceUrl: string,
): ScrapedGallery {
  const images: ScrapedGalleryImage[] = [];
  const seen = new Set<string>();

  const re =
    /<a\b([^>]*\bclass\s*=\s*["'][^"']*\bpicture\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || "";
    const inner = m[2] || "";
    const url = attrs.match(/\bhref\s*=\s*(['"])([^'"]+)\1/i)?.[2];
    if (!url || seen.has(url)) continue;
    seen.add(url);

    // The thumbnail is the `<img src>` inside this anchor.
    //
    // It MUST be read from the markup rather than built by hand: the
    // `?secure=` token is signed for one specific path, so swapping
    // `full` → `new_small` while keeping the anchor's token produces a
    // 403. The page publishes the correctly-signed small URL already.
    const thumb =
      inner.match(/\bsrc\s*=\s*(['"])(https?:\/\/[^'"]+)\1/i)?.[2] ?? url;

    images.push({ url, thumb, width: null, height: null });
  }

  // Title: the page's `<title>` is the gallery's own name ("Actually, i
  // really do give a hoot..."). The `<h1>` is the site's generic name
  // ("Pornchat Multi Pictures"), so the `<title>` wins.
  const rawTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = rawTitle
    ? decodeEntities(rawTitle).replace(/\s+/g, " ").trim()
    : null;

  // Description: the site's own line under the heading.
  const rawDesc = html.match(
    /<div\b[^>]*class\s*=\s*["'][^"']*\bdescription_text\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  )?.[1];
  const description = rawDesc
    ? stripTags(rawDesc).slice(0, 500) || null
    : null;

  // Tags: PornChat prints them as a plain comma-separated line in a
  // `<div class="tags">` — "milf, open pussy, solo".
  const tags: string[] = [];
  const tagText = stripTags(
    html.match(/<div\b[^>]*class\s*=\s*["'][^"']*\btags\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "",
  );
  for (const raw of tagText.split(",")) {
    const t = raw.trim();
    if (!t || t.length > 40) continue;
    if (!tags.includes(t)) tags.push(t);
    if (tags.length >= 30) break;
  }

  return {
    title: title || null,
    description,
    sourceUrl,
    coverUrl: images[0]?.url ?? null,
    images,
    // PornChat does not link the model on the gallery page. The title is
    // the gallery's own name, not a model name, so we leave it null
    // rather than mislabel the gallery.
    modelName: null,
    channelName: "Pornchat",
    categories: [],
    tags,
    sourceViews: null,
  };
}

/* ══════════════════════════════════════════════════════════════
   BABESOURCE
   ══════════════════════════════════════════════════════════════ */

/**
 * Does this page use BabeSource's gallery markup?
 *
 * The signature is the `slideshowGalleryImage` class on the anchors that
 * link each photo — detected from the markup so a lookalike site running
 * the same CMS is recognised too.
 */
function looksLikeBabeSourceGallery(html: string): boolean {
  return /class\s*=\s*["'][^"']*\bslideshowGalleryImage\b[^"']*["']/i.test(html);
}

/**
 * BabeSource's gallery markup.
 *
 *   <a data-index="0"
 *      class="box-massage__card-link slideshowGalleryImage"
 *      href="https://babesource.com/media/galleries/<id>/<name>_001.jpg"
 *      data-msrc="https://babesource.com/media/galleries/<id>/m1080/<name>_001.jpg.webp">
 *
 * The `href` is the full-size file; `data-msrc` is the smaller mobile
 * variant. The gallery is the run of `slideshowGalleryImage` anchors — the
 * page also links to a few unrelated images (flags, ads, paysites), so
 * matching on that class is what keeps them out.
 *
 * The page has no `<h1>` and no model/studio links. The title comes from
 * `<title>` ("Polly Yangs - Bratty Sis | BabeSource.com"), which we
 * clean by dropping the brand suffix; the model is the leading segment
 * of that title.
 */
function parseBabeSourceGallery(
  html: string,
  sourceUrl: string,
): ScrapedGallery {
  const images: ScrapedGalleryImage[] = [];
  const seen = new Set<string>();

  const re = /<a\b([^>]*\bslideshowGalleryImage\b[^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || "";
    const url = attrs.match(/\bhref\s*=\s*(['"])([^'"]+)\1/i)?.[2];
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const thumb =
      attrs.match(/\bdata-msrc\s*=\s*(['"])([^'"]+)\1/i)?.[2] ?? url;

    // BabeSource states the pixel size on the anchor in `data-width` /
    // `data-height` on some templates; when absent we leave it null and
    // the grid falls back to a fixed aspect ratio.
    const w = attrs.match(/\bdata-width\s*=\s*['"]?(\d+)/i)?.[1] ?? null;
    const h = attrs.match(/\bdata-height\s*=\s*['"]?(\d+)/i)?.[1] ?? null;

    images.push({
      url,
      thumb,
      width: w ? Number(w) : null,
      height: h ? Number(h) : null,
    });
  }

  // Title: "Polly Yangs - Bratty Sis | BabeSource.com" → "Polly Yangs - Bratty Sis"
  const rawTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const cleanedTitle = rawTitle
    ? decodeEntities(rawTitle).replace(/\s+/g, " ").trim()
    : "";
  const title = cleanedTitle
    .replace(/\s*[|–—]\s*BabeSource\.com\s*$/i, "")
    .trim();

  // Model: the part before the first separator — "Polly Yangs".
  const modelName = title.split(/\s+[-–—]\s+/)[0]?.trim() || null;

  const rawDesc =
    html.match(
      /<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["']/i,
    )?.[1] ??
    html.match(
      /<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["']/i,
    )?.[1];
  const description = rawDesc
    ? decodeEntities(rawDesc).replace(/\s+/g, " ").trim().slice(0, 500)
    : null;

  return {
    title: title || null,
    description,
    sourceUrl,
    coverUrl: images[0]?.url ?? null,
    images,
    modelName: modelName && modelName.length <= 120 ? modelName : null,
    // BabeSource has no studio/channel concept on the gallery page.
    channelName: null,
    categories: [],
    tags: extractGenericTags(html),
    sourceViews: null,
  };
}

/* ══════════════════════════════════════════════════════════════
   GENERIC — any other gallery site
   ══════════════════════════════════════════════════════════════ */

/**
 * A best-effort parser for gallery sites we have no dedicated parser for.
 *
 * The goal is "the admin pastes a gallery link from ANY site and gets the
 * pictures". Every gallery page, whatever CMS it runs on, ends up with a
 * list of `<img>` tags (or anchors pointing at images) inside one big
 * container. So we:
 *
 *   1. Find the block of markup that holds the most image references —
 *      that's the gallery, not the site chrome (logos, banners, avatars).
 *   2. Read every image URL inside it.
 *   3. Pull the title, description and tags from the page's own metadata.
 *
 * We deliberately do NOT try to be clever about full-size vs thumbnail.
 * Instead each image URL is normalised to a "full" candidate and a
 * "thumb" candidate: the original URL is kept as the thumbnail (always
 * valid) and a larger variant is attempted only when the URL clearly
 * encodes a size segment we know how to bump. That way a wrong guess can
 * never produce a broken image — worst case the gallery renders at the
 * size the site already publishes.
 */

/** Image extensions we accept. */
const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp|gif|avif)(?:\?.*)?$/i;

/**
 * Does this URL point at an image?
 *
 * Two shapes qualify: a path that ends in an image extension, and a path
 * that ends in an extension-less "image service" URL (common on CDNs like
 * `…/photo/12345`). The latter is matched on a segment named `image` or
 * `img` so we don't sweep up every extension-less URL on the page.
 */
function looksLikeImageUrl(url: string): boolean {
  const clean = url.split("#")[0].split("?")[0];
  if (IMAGE_EXT_RE.test(url)) return true;
  return /\/(?:image|img|photo)s?\/\d+(?:\/|$)/i.test(clean);
}

/**
 * Resolve a possibly-relative URL against the page it was found on.
 */
function absolutise(url: string, base: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  // Skip data: URIs and javascript: — never useful as a source.
  if (/^(?:data|javascript|mailto|tel):/i.test(trimmed)) return null;
  try {
    const resolved = new URL(trimmed, base);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

/**
 * Candidate "larger" URL for an image.
 *
 * Many CDNs encode the pixel size in the path or the filename
 * (`…_1200.jpg`, `…/1280/…jpg`, `…_w400.jpg`). When we recognise one of
 * those patterns we produce a bigger variant; otherwise we return the
 * original, which is always safe to render.
 *
 * The plain `_400` form is deliberately NOT rewritten: in a gallery file
 * name like `photo_01.jpg` the trailing digits are the photo's serial,
 * not a size, and bumping them would invent a URL that doesn't exist.
 * Only an explicitly marked size (`_w400`) or a size in the path is
 * trusted.
 */
function toLargerVariant(url: string): string {
  // `…/galleries/new_small/…` → `…/galleries/full/…`  (PornChat style)
  if (/\/(?:new_small|new_big|small|medium|big)\//i.test(url)) {
    return url.replace(
      /\/(?:new_small|new_big|small|medium|big)\//i,
      "/full/",
    );
  }
  // `name_w400.jpg` → `name_1200.jpg`  (Babehub/Elitebabes/Femjoy style)
  if (/_\w(\d{2,4})\.(jpe?g|png|webp)$/i.test(url)) {
    return url.replace(/_\w(\d{2,4})\.(jpe?g|png|webp)$/i, "_1200.$2");
  }
  // `…/460/…jpg` → `…/1280/…jpg`  (PornPics style)
  if (/\/(?:460|800|1024)\//.test(url)) {
    return url.replace(/\/(?:460|800|1024)\//, "/1280/");
  }
  return url;
}

/**
 * How big is the image this URL points at?
 *
 * Used to decide which of two URLs for the SAME photo is the full-size
 * one. The size is read from whatever the provider encodes:
 *
 *   • a pixel size in the path   — `…/1280/…/x.jpg`
 *   • a named variant folder     — `…/galleries/full/…` vs `…/new_small/…`
 *   • a size in the filename     — `x_1200.jpg` vs `x_w400.jpg`
 *
 * A URL with no size information at all ranks 0 — we can never claim it
 * is bigger than one that states its size.
 */
function imageSizeRank(url: string): number {
  const clean = url.split("#")[0].split("?")[0];
  const lower = clean.toLowerCase();

  // A named variant folder.
  const named: Array<[string, number]> = [
    ["original", 5000],
    ["full", 4000],
    ["new_big", 3500],
    ["big", 3000],
    ["large", 2500],
    ["medium", 1500],
    ["new_small", 1000],
    ["small", 900],
    ["thumb", 800],
    ["thumbnail", 800],
  ];
  for (const [name, rank] of named) {
    if (lower.includes(`/${name}/`)) return rank;
  }

  // A pixel size in the path.
  const pathSize = lower.match(/\/(\d{3,4})\//);
  if (pathSize) return Number(pathSize[1]);

  // A size in the filename — `x_1200.jpg`, `x_w400.jpg`.
  const nameSize = lower.match(/[_\-](?:w)?(\d{3,4})\.(?:jpe?g|png|webp)$/);
  if (nameSize) return Number(nameSize[1]);

  return 0;
}

/**
 * Is this URL site chrome rather than gallery content?
 *
 * Logos, loading spinners, sprites, avatars and badges live on the same
 * CDN as the photos but are not part of the gallery. We recognise the
 * common ones by their filename so they never end up in a gallery.
 */
function isSiteChromeUrl(url: string): boolean {
  const clean = url.split("#")[0].split("?")[0];
  const file = (clean.split("/").pop() || "").toLowerCase();
  if (!file) return false;

  // "pornchat-brand-logo@2x.png", "logo.svg", "loading.gif", …
  if (/(?:^|[-_])(?:logo|brand|loading|loader|spinner|placeholder|banner|sprite|avatar|icon|favicon)(?:[-_@.]|$)/i.test(file)) {
    return true;
  }
  // A tiny spacer — the classic 1×1 tracking pixel.
  if (/\/(?:pixel|beacon|track|tracking|1x1|spacer|blank)(?:[-_.@]|\.)/i.test(clean)) {
    return true;
  }
  return false;
}

/**
 * Find the region of the page that holds the gallery.
 *
 * The naive approach — split on `<div>` and keep the block with the most
 * images — breaks on sites that wrap EVERY photo in its own container
 * (PornChat does: one `<div class="tcContainer">` per photo). Splitting
 * there isolates a single photo per block, so no block ever contains the
 * whole gallery.
 *
 * Instead we work from the image references themselves:
 *
 *   1. Collect every image reference in the page, in document order.
 *   2. Slide a window over them and find the span with the most DISTINCT
 *      images. That span is the gallery — unrelated chrome is far away
 *      from the photos, so it falls outside the window.
 *   3. The region is the HTML from the first to the last image in that
 *      span, widened to the enclosing block tag so sibling markup (the
 *      `<img>` inside the anchor, a caption) is included.
 *
 * A window is used rather than "all images" because a page often has a
 * handful of unrelated images (avatar, promo banner) far from the
 * gallery. A tight window keeps those out.
 */
function findGalleryRegion(html: string): string {
  // ---- 1. Every image reference, in document order -----------------
  interface Ref {
    url: string;
    start: number;
    end: number;
  }
  const refs: Ref[] = [];

  const pushRef = (raw: string, start: number, end: number) => {
    if (!looksLikeImageUrl(raw)) return;
    if (isSiteChromeUrl(raw)) return;
    refs.push({ url: raw.split("#")[0].split("?")[0], start, end });
  };

  const imgRe = /<img\b[^>]*\bsrc\s*=\s*(['"])([^'"]+)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    pushRef(m[2], m.index, m.index + m[0].length);
  }

  const srcsetRe = /<[^>]*\bsrcset\s*=\s*(['"])([^'"]+)\1/gi;
  while ((m = srcsetRe.exec(html)) !== null) {
    for (const part of m[2].split(",")) {
      const u = part.trim().split(/\s+/)[0];
      if (u) pushRef(u, m.index, m.index + m[0].length);
    }
  }

  const anchorRe = /<a\b([^>]*)>/gi;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1].match(/\bhref\s*=\s*(['"])([^'"]+)\1/i)?.[2];
    if (href) pushRef(href, m.index, m.index + m[0].length);
  }

  if (refs.length === 0) return html;

  // ---- 2. The window with the most distinct images ------------------
  //
  // A window is "dense" when it holds many DIFFERENT images — the same
  // photo referenced by both its thumbnail and its full-size twin must
  // not count twice, or a page of 13 photos each listed twice would look
  // like 13 good and the search would stop early.
  const best = findDensestWindow(refs);

  // ---- 3. The HTML span covering that window ------------------------
  const first = refs[best.from];
  const last = refs[best.to];

  // Widen to the nearest enclosing block tags so we also capture the
  // `<img>` that lives inside an anchor, plus any captions.
  let start = first.start;
  const openBefore = html.lastIndexOf("<div", first.start);
  const openUl = html.lastIndexOf("<ul", first.start);
  const openTag = Math.max(openBefore, openUl);
  if (openTag >= 0 && first.start - openTag < 4000) start = openTag;

  let end = last.end;
  const closeAfter = html.indexOf("</div>", last.end);
  const closeUl = html.indexOf("</ul>", last.end);
  const closeTag = closeAfter >= 0 ? closeAfter : closeUl;
  if (closeTag >= 0 && closeTag - last.end < 4000) end = closeTag + 6;

  return html.slice(start, end);
}

/**
 * Slide a window over the image references and return the span holding the
 * most distinct images.
 *
 * "Distinct" is measured by the normalised directory + filename stem, so
 * a thumbnail and its full-size twin count as one photo.
 */
function findDensestWindow(refs: Array<{ url: string }>): {
  from: number;
  to: number;
  count: number;
} {
  // How wide may a window be? A gallery page's photos are contiguous in
  // the markup, so a window that spans far more than this many
  // references has wandered into unrelated page content.
  const MAX_WINDOW = 400;

  let best = { from: 0, to: 0, count: 0 };
  let left = 0;
  const seen = new Map<string, number>();

  for (let right = 0; right < refs.length; right++) {
    const key = imageStem(refs[right].url) + "::" + imageDir(refs[right].url);
    seen.set(key, (seen.get(key) ?? 0) + 1);

    // Shrink the window from the left while it is too wide, keeping the
    // counts in sync.
    while (right - left + 1 > MAX_WINDOW) {
      const oldKey =
        imageStem(refs[left].url) + "::" + imageDir(refs[left].url);
      const c = (seen.get(oldKey) ?? 1) - 1;
      if (c <= 0) seen.delete(oldKey);
      else seen.set(oldKey, c);
      left++;
    }

    if (seen.size > best.count) {
      best = { from: left, to: right, count: seen.size };
    }
  }

  return best;
}

/**
 * Pull the image list out of a region of markup.
 *
 * Three sources, merged in priority order:
 *   1. `<img src>` / `<img srcset>` — the rendered thumbnails.
 *   2. `data-src` / `data-original` / `data-lazy-src` — lazy-loaded images
 *      whose real URL is parked in a data attribute.
 *   3. `<a href>` pointing at an image — the full-size file, when the page
 *      links to it (lightbox galleries do this).
 *
 * The first two give the *visible* image; the third often gives a larger
 * one for the same photo. We merge them by their filename stem so a
 * thumbnail and its full-size twin collapse into a single entry.
 */
function extractGenericImages(
  html: string,
  sourceUrl: string,
): ScrapedGalleryImage[] {
  const region = findGalleryRegion(html);
  const byStem = new Map<string, ScrapedGalleryImage>();
  const order: string[] = [];

  // Exact-URL guard. Two different paths can reduce to the same stem (e.g.
  // `a/x.jpg` and `b/x.jpg`), and the same URL can appear in `src`,
  // `srcset` and a lightbox `href` at once. This set makes sure an image
  // only ever lands in the list ONCE.
  const seenUrls = new Set<string>();

  const add = (
    rawUrl: string,
    width: number | null,
    height: number | null,
  ) => {
    if (isSiteChromeUrl(rawUrl)) return;
    const abs = absolutise(rawUrl, sourceUrl);
    if (!abs) return;

    // Strip the query string for the identity check — `x.jpg?v=2` and
    // `x.jpg?v=3` are the same file.
    const identity = abs.split("#")[0].split("?")[0].toLowerCase();
    if (seenUrls.has(identity)) return;
    seenUrls.add(identity);

    // The stem is the filename without its SIZE suffix — used to tell
    // `x_w400.jpg` and `x_1200.jpg` (the same photo) apart from two
    // genuinely different photos. See `imageStem` for why the photo's own
    // serial number must survive.
    const file = identity.split("/").pop() || identity;
    const stem = imageStem(identity);

    // The path without the filename distinguishes two files that happen to
    // share a name — `set-a/01.jpg` and `set-b/01.jpg` are different
    // photos, so only merge when the DIRECTORY matches too.
    const dir = imageDir(identity);
    const key = `${dir}::${stem}`;

    const existing = byStem.get(key);
    if (existing) {
      // Same photo seen again (thumbnail + full-size). Keep the larger URL
      // as the full-size image and fill in any dimensions we don't have.
      //
      // "Larger" is decided by the size the URL encodes, NOT by string
      // length — `…/full/…/0.jpg` and `…/new_small/…/0.jpg` are nearly the
      // same length, and comparing lengths would keep the thumbnail.
      if (imageSizeRank(abs) > imageSizeRank(existing.url)) {
        existing.url = toLargerVariant(abs);
        existing.thumb = abs;
      }
      if (!existing.width && width) existing.width = width;
      if (!existing.height && height) existing.height = height;
      return;
    }

    const full = toLargerVariant(abs);
    byStem.set(key, {
      url: full,
      thumb: abs,
      width,
      height,
    });
    order.push(key);
  };

  // ---- 1. <img> tags -------------------------------------------------
  const imgRe = /<img\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(region)) !== null) {
    const attrs = m[1] || "";

    // Real dimensions, when the page states them.
    const w = attrs.match(/\bwidth\s*=\s*['"]?(\d+)/i)?.[1];
    const h = attrs.match(/\bheight\s*=\s*['"]?(\d+)/i)?.[1];

    // Lazy-loaded sources first — `src` is often a 1×1 placeholder.
    const lazy = attrs.match(
      /\b(?:data-src|data-original|data-lazy-src|data-actualsrc|data-zoom-image)\s*=\s*(['"])([^'"]+)\1/i,
    )?.[2];
    if (lazy && looksLikeImageUrl(lazy)) {
      add(lazy, w ? Number(w) : null, h ? Number(h) : null);
    }

    const src = attrs.match(/\bsrc\s*=\s*(['"])([^'"]+)\1/i)?.[2];
    if (src && looksLikeImageUrl(src)) {
      add(src, w ? Number(w) : null, h ? Number(h) : null);
    }

    // `srcset` — take the largest candidate listed.
    const srcset = attrs.match(/\bsrcset\s*=\s*(['"])([^'"]+)\1/i)?.[2];
    if (srcset) {
      let bestUrl: string | null = null;
      let bestW = 0;
      for (const part of srcset.split(",")) {
        const bits = part.trim().split(/\s+/);
        const u = bits[0];
        if (!u || !looksLikeImageUrl(u)) continue;
        const pw = Number(bits[1]?.replace(/w$/i, "")) || 0;
        if (pw >= bestW) {
          bestW = pw;
          bestUrl = u;
        }
      }
      if (bestUrl) add(bestUrl, w ? Number(w) : null, h ? Number(h) : null);
    }
  }

  // ---- 2. Anchors pointing at the full-size file --------------------
  //
  // The attribute string is captured whole (`<a\b([^>]*)>`) and the href is
  // then read from THAT string. Matching the href inline (as in
  // `<a\b[^>]*\bhref=…>`) is greedy — `[^>]*` swallows the href before the
  // pattern gets to it, so the anchor silently fails to match.
  const anchorRe = /<a\b([^>]*)>/gi;
  while ((m = anchorRe.exec(region)) !== null) {
    const attrs = m[1] || "";
    const href = attrs.match(/\bhref\s*=\s*(['"])([^'"]+)\1/i)?.[2];
    if (!href || !looksLikeImageUrl(href)) continue;
    const w = attrs.match(/\bdata-width\s*=\s*['"]?(\d+)/i)?.[1] ?? null;
    const h = attrs.match(/\bdata-height\s*=\s*['"]?(\d+)/i)?.[1] ?? null;
    add(href, w ? Number(w) : null, h ? Number(h) : null);
  }

  return order.map((stem) => byStem.get(stem)).filter(Boolean) as ScrapedGalleryImage[];
}

/**
 * The page's own metadata, read generically.
 *
 * Title: `<h1>` first (it is the gallery's own heading on nearly every
 * site), then `<title>` with the site-name suffix trimmed.
 *
 * Tags: links whose path segment reads `tag`/`tags`/`category`/
 * `categories` — a very consistent convention across gallery CMSes.
 */
function extractGenericTitle(html: string): string | null {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const fromH1 = h1 ? stripTags(h1) : "";
  if (fromH1 && fromH1.length <= 300) return fromH1;

  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (!raw) return null;
  const cleaned = decodeEntities(raw).replace(/\s+/g, " ").trim();
  // Drop a trailing " - Site Name" / " | Site Name" if the title has two
  // halves; keep the first.
  const trimmed = cleaned.split(/\s+[|–—]\s+/)[0].trim();
  return trimmed || cleaned;
}

function extractGenericTags(html: string): string[] {
  const tags: string[] = [];
  const re =
    /<a\b[^>]*\bhref\s*=\s*(['"])([^'"]*\/(?:tags?|categories)\/[^'"]+)\1[^>]*>([\s\S]*?)<\/a>/gi;

  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = stripTags(m[3]);
    if (!text || text.length > 60) continue;
    if (!tags.includes(text)) tags.push(text);
    if (tags.length >= 40) break;
  }
  return tags;
}

/**
 * A studio / channel / model name, read generically.
 *
 * Looks for links whose path segment reads `channel`, `studio`, `publisher`
 * or `brand`, and falls back to the `<h1>`'s leading segment.
 */
function extractGenericChannel(html: string): string | null {
  const re =
    /<a\b[^>]*\bhref\s*=\s*(['"])([^'"]*\/(?:channels?|studios?|publishers?|brands?)\/[^'"]+)\1[^>]*>([\s\S]*?)<\/a>/i;
  const m = html.match(re);
  if (m) {
    const text = stripTags(m[3]);
    if (text && text.length <= 120) return text;
  }
  return null;
}

/**
 * A model / performer name, read generically.
 *
 * Same idea as the channel, for `model`/`models`/`pornstar`/`pornstars`
 * paths. On sites that have neither, we leave it null rather than guess.
 */
function extractGenericModel(html: string): string | null {
  const re =
    /<a\b[^>]*\bhref\s*=\s*(['"])([^'"]*\/(?:models?|pornstars?|stars?|performers?)\/[^'"]+)\1[^>]*>([\s\S]*?)<\/a>/i;
  const m = html.match(re);
  if (m) {
    const text = stripTags(m[3]);
    if (text && text.length <= 120) return text;
  }
  return null;
}

/**
 * A view count, read generically.
 *
 * Looks for a number next to the words "views"/"hits" in the page text.
 * If nothing matches we return null — we never invent a number.
 */
function extractGenericViews(html: string): number | null {
  const text = stripTags(html);
  const m = text.match(
    /\b([\d][\d,.\s]{1,12})\s*(?:views?|hits?|impressions)\b/i,
  );
  if (!m) return null;
  const n = Number(m[1].replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Assemble the generic result. */
function parseGenericGallery(html: string, sourceUrl: string): ScrapedGallery {
  const images = extractGenericImages(html, sourceUrl);
  return {
    title: extractGenericTitle(html),
    description: extractGenericDescription(html),
    sourceUrl,
    coverUrl: images[0]?.url ?? null,
    images,
    modelName: extractGenericModel(html),
    channelName: extractGenericChannel(html),
    categories: [],
    tags: extractGenericTags(html),
    sourceViews: extractGenericViews(html),
  };
}

/** The page's meta description, lightly trimmed. */
function extractGenericDescription(html: string): string | null {
  const raw =
    html.match(
      /<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["']/i,
    )?.[1] ??
    html.match(
      /<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["']/i,
    )?.[1];
  if (!raw) return null;
  const text = decodeEntities(raw).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 500) : null;
}
