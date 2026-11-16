import { getSiteConfig } from "@/lib/config";
import { buildMetadata } from "@/lib/metadata";
import { NotFoundView } from "@/components/pages/NotFoundView";

export function generateMetadata() {
  const site = getSiteConfig();
  return buildMetadata({
    title: `৪০৪ — পৃষ্ঠা পাওয়া যায়নি — ${site.title}`,
    description: `আপনি যে পৃষ্ঠাটি খুঁজছেন তা বিদ্যমান নেই। ${site.seo?.description || site.description} এর হোমপেজে ফিরে যান।`,
    robots: "noindex, follow",
    locale: "bn",
  });
}

export default function NotFound() {
  return <NotFoundView locale="bn" />;
}
