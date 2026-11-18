import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/config";
import { buildMetadata } from "@/lib/metadata";
import { VideoListShell } from "@/components/VideoListShell";

// ISR budget: was 3600s. Vercel Hobby caps ISR writes at
// 200K/30d and this route was regenerating far too often. Publishes purge
// these paths on demand (revalidatePath), so the timer is only a fallback.
export const revalidate = 21600;

export async function generateMetadata(): Promise<Metadata> {
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  // `buildMetadata` (rather than a bare object) is what gives this page a
  // self-referencing canonical and the full OG/Twitter card set. Without it
  // /videos inherited the homepage's canonical, which told Google the two
  // pages were duplicates and to drop one of them.
  return buildMetadata({
    title: "ভিডিও — সদ্য প্রকাশিত ভিডিও গ্যালারি",
    description:
      "সদ্য প্রকাশিত ভিডিও, দেশভেদে ব্লক ছাড়াই — প্রতিদিন নতুন ভিডিও যোগ হচ্ছে। বাংলা চটি গল্প ও সিরিজের ভিডিও এক জায়গায়।",
    url: `${base}/videos`,
    skipKeywordTitle: true,
  });
}

const SUBTITLE =
  "Provider-এর player-এ সরাসরি চলে — কোনো ফাইল ডাউনলোড নেই, কোনো rehost নেই। প্রতিটি দেখা আলাদাভাবে গণনা হয়।";

export default function VideosPage() {
  return <VideoListShell title="ভিডিও" subtitle={SUBTITLE} currentPage={1} />;
}