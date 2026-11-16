import { NextResponse } from "next/server";
import { isBotRequest } from "@/lib/bot-guard";
import {
  fetchGalleryHtmlDetailed,
  parseGallery,
  isAllowedGalleryHost,
  type GalleryFetchError,
} from "@/lib/picture-scraper";

export const dynamic = "force-dynamic";

/**
 * A clear, actionable message for each way the fetch can fail.
 *
 * The distinction matters: a broken link needs a corrected URL, a bot
 * challenge needs a different site, and a timeout just needs a retry.
 */
const FETCH_ERROR_MESSAGES: Record<GalleryFetchError, string> = {
  "invalid-url": "লিংকটি সঠিক নয়। আবার দেখে দিন।",
  "blocked-host":
    "এই ঠিকানা থেকে গ্যালারি আনা যায়নি (অভ্যন্তরীণ নেটওয়ার্ক নিষিদ্ধ)।",
  timeout: "সাইটটি সাড়া দিচ্ছে না। একটু পরে আবার চেষ্টা করুন।",
  forbidden:
    "সাইটটি সার্ভার থেকে অনুরোধ ব্লক করেছে। অন্য একটি গ্যালারি লিংক ব্যবহার করুন।",
  challenge:
    "এই সাইটটি বট চেক (Cloudflare) দিয়ে সুরক্ষিত, তাই সার্ভার থেকে ছবি আনা যাচ্ছে না। অন্য একটি গ্যালারি লিংক ব্যবহার করুন।",
  "http-error":
    "গ্যালারি পেজটি আনা যায়নি। লিংকটি আবার দেখুন।",
  "network-error":
    "গ্যালারি পেজটি আনা যায়নি। ইন্টারনেট সংযোগ দেখে নিন।",
};

/**
 * Server-side gallery metadata lookup.
 *
 * The admin pastes a gallery URL; this endpoint fetches the provider's page
 * and returns the full picture series — every image URL (full-size and
 * thumbnail), the title, the model, the channel, the categories and the
 * tags.
 *
 * GET /api/picture-metadata?url=<gallery url>
 *
 * The admin form calls this on a debounce so the whole series is filled in
 * without typing anything.
 */

export async function GET(req: Request) {
  // Fetches a remote page and parses it with several regexes — reject
  // obvious scrapers before that work starts.
  if (isBotRequest(req)) {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("url") || "").trim();

  if (!raw) {
    return NextResponse.json({ error: "missing url" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json({ error: "unsupported protocol" }, { status: 400 });
  }

  if (!isAllowedGalleryHost(target.hostname)) {
    return NextResponse.json(
      { error: "এই ঠিকানা থেকে গ্যালারি আনা যায়নি (অভ্যন্তরীণ নেটওয়ার্ক নিষিদ্ধ)।" },
      { status: 400 },
    );
  }

  const { html, error, status } = await fetchGalleryHtmlDetailed(
    target.toString(),
  );

  if (!html) {
    return NextResponse.json(
      { error: FETCH_ERROR_MESSAGES[error ?? "network-error"], status: status ?? 502 },
      { status: error === "blocked-host" || error === "invalid-url" ? 400 : 502 },
    );
  }

  const gallery = parseGallery(html, target.toString());

  if (gallery.images.length === 0) {
    return NextResponse.json(
      { error: "এই লিংকে কোনো ছবি পাওয়া যায়নি।" },
      { status: 422 },
    );
  }

  return NextResponse.json({
    title: gallery.title,
    description: gallery.description,
    sourceUrl: gallery.sourceUrl,
    coverUrl: gallery.coverUrl,
    images: gallery.images,
    imageCount: gallery.images.length,
    modelName: gallery.modelName,
    channelName: gallery.channelName,
    categories: gallery.categories,
    tags: gallery.tags,
    sourceViews: gallery.sourceViews,
  });
}
