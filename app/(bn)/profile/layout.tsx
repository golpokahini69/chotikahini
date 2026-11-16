import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/config";

/**
 * User profile — `/profile`.
 *
 * The profile dashboard is entirely session-driven: everything on it
 * (comments, saved posts, reading history, the author workspace) is fetched
 * client-side for the logged-in user. A crawler receives an empty shell, so
 * the page was inheriting the root layout's homepage canonical and
 * `index, follow`.
 *
 * `noindex, follow` takes the page out of the index while keeping the
 * links inside it (author profiles, story links) crawlable. robots.txt also
 * disallows `/profile`.
 */
export function generateMetadata(): Metadata {
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  return {
    title: `আমার প্রোফাইল — ${site.title}`,
    description: `আপনার প্রোফাইল, সংরক্ষিত গল্প, মতামত ও লেখক ওয়ার্কস্পেস।`,
    robots: {
      index: false,
      follow: true,
    },
    alternates: {
      canonical: `${base}/profile`,
    },
  };
}

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
