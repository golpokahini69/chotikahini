import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/config";
import { buildMetadata } from "@/lib/metadata";
import type { Locale } from "@/lib/i18n/locale";

/** Metadata for the community posts page. */
export function postsMetadata(locale: Locale): Metadata {
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;

  return buildMetadata({
    title:
      locale === "en"
        ? `Posts — ${site.title}`
        : `পোস্ট — ${site.title}`,
    description:
      locale === "en"
        ? "The community post feed — share your opinion, like and comment."
        : "ব্যবহারকারীদের পোস্ট ফিড — মতামত শেয়ার করুন, লাইক ও মন্তব্য করুন।",
    url: locale === "en" ? `${base}/en/posts` : `${base}/posts`,
    locale,
    // The community feed is fetched client-side from `/api/community/posts`,
    // so the server-rendered HTML for a crawler is just the heading — 361
    // characters of text and no posts. It was being offered to the index as
    // a thin page whose content changes on every request, which is a
    // duplicate-content and freshness problem rather than an asset.
    robots: "noindex, follow",
  });
}
