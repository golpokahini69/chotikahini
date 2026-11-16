import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/config";

/**
 * Chat room — `/chat`.
 *
 * The chat page is a session-driven app surface: its content depends on who
 * is logged in, so the server-rendered HTML for a crawler is a near-empty
 * login shell. It inherited the root layout's canonical (the homepage) and
 * `index, follow`, which meant Google was told to index a thin page that
 * duplicated the homepage.
 *
 * `noindex, follow` keeps the links inside it crawlable while taking the
 * page itself out of the index. robots.txt also disallows `/chat`.
 */
export function generateMetadata(): Metadata {
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  return {
    title: `গ্লোবাল চ্যাট — ${site.title}`,
    description: `পাঠকদের সাথে সরাসরি কথা বলুন — গ্লোবাল চ্যাট রুমে যোগ দিন।`,
    robots: {
      index: false,
      follow: true,
    },
    alternates: {
      canonical: `${base}/chat`,
    },
  };
}

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
