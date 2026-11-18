import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/config";
import { buildMetadata } from "@/lib/metadata";
import { PictureListShell } from "@/components/PictureListShell";

// ISR budget: was 3600s. Vercel Hobby caps ISR writes at
// 200K/30d and this route was regenerating far too often. Publishes purge
// these paths on demand (revalidatePath), so the timer is only a fallback.
export const revalidate = 21600;

export async function generateMetadata(): Promise<Metadata> {
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  // `buildMetadata` (rather than a bare object) is what gives this page a
  // self-referencing canonical and the full OG/Twitter card set. Without it
  // /pictures inherited the homepage's canonical, which told Google the two
  // pages were duplicates and to drop one of them.
  return buildMetadata({
    title: "ছবি — ছবির গ্যালারি",
    description:
      "সদ্য প্রকাশিত ছবির গ্যালারি — প্রতিটি সিরিজের সব ছবি একসাথে। বাংলা গল্পের ছবি সিরিজ ব্রাউজ করুন।",
    url: `${base}/pictures`,
    skipKeywordTitle: true,
  });
}

const SUBTITLE =
  "প্রতিটি গ্যালারির সব ছবি একসাথে — ছবিতে ক্লিক করলে বড় করে দেখা যাবে।";

export default function PicturesPage() {
  return (
    <PictureListShell title="ছবি" subtitle={SUBTITLE} currentPage={1} />
  );
}
