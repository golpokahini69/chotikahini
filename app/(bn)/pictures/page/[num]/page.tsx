import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/config";
import { buildMetadata } from "@/lib/metadata";
import { PictureListShell } from "@/components/PictureListShell";
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
    title: `ছবি — পাতা ${page}`,
    description: `সদ্য প্রকাশিত ছবির গ্যালেরি, পাতা ${page} — প্রতিটি সিরিজের সব ছবি একসাথে।`,
    url: `${base}/pictures/page/${num}`,
    skipKeywordTitle: true,
  });
}

const SUBTITLE =
  "প্রতিটি গ্যালারির সব ছবি একসাথে — ছবিতে ক্লিক করলে বড় করে দেখা যাবে।";

export default async function PicturesPagedPage({
  params,
}: {
  params: Promise<{ num: string }>;
}) {
  const { num } = await params;
  const page = Number(num);
  if (!Number.isFinite(page) || page < 2) notFound();
  return (
    <PictureListShell
      title="ছবি"
      subtitle={SUBTITLE}
      currentPage={page}
    />
  );
}
