import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/config";
import { buildMetadata } from "@/lib/metadata";
import { VideoListShell } from "@/components/VideoListShell";
import { notFound } from "next/navigation";

// ISR budget: was 3600s. Vercel Hobby caps ISR writes at
// 200K/30d and this route was regenerating far too often. Publishes purge
// these paths on demand (revalidatePath), so the timer is only a fallback.
export const revalidate = 21600;

/**
 * Empty by design — it is what registers this route for ISR.
 *
 * With `revalidate` but NO `generateStaticParams`, Next 16 leaves the route
 * out of the prerender manifest's `dynamicRoutes`, silently ignoring the
 * revalidate above: every request paid a full server render plus fresh
 * database reads, and the build shipped it as plain `ƒ (Dynamic)` (verified
 * in production: `x-vercel-cache: MISS` + `private, no-store`).
 *
 * `[]` means "prerender nothing, render on demand" — the on-demand render is
 * then CACHED and reused for `revalidate` seconds instead. Unknown params
 * still render because Next defaults `dynamicParams` to true.
 */
export function generateStaticParams(): { num: string }[] {
  return [];
}

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