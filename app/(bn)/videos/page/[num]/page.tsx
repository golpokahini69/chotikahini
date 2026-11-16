import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/config";
import { buildMetadata } from "@/lib/metadata";
import { VideoListShell } from "@/components/VideoListShell";
import { notFound } from "next/navigation";

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ num: string }>;
}): Promise<Metadata> {
  const { num } = await params;
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  const page = Number(num);
  return buildMetadata({
    title: `ভিডিও — পাতা ${page}`,
    description: `সদ্য প্রকাশিত ভিডিও, পাতা ${page} — দেশভেদে ব্লক ছাড়াই। বাংলা চটি গল্প ও সিরিজের ভিডিও এক জায়গায়।`,
    url: `${base}/videos/page/${num}`,
    skipKeywordTitle: true,
  });
}

const SUBTITLE =
  "Provider-এর player-এ সরাসরি চলে। প্রতিটি দেখা আলাদাভাবে গণনা হয়।";

export default async function VideosPagedPage({
  params,
}: {
  params: Promise<{ num: string }>;
}) {
  const { num } = await params;
  const page = Number(num);
  if (!Number.isFinite(page) || page < 2) notFound();
  return (
    <VideoListShell
      title="ভিডিও"
      subtitle={SUBTITLE}
      currentPage={page}
    />
  );
}