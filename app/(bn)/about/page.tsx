import type { Metadata } from "next";
import { aboutMetadata, getAboutData } from "@/lib/routes/about";
import { AboutView } from "@/components/pages/AboutView";
import { JsonLd } from "@/components/JsonLd";
import { buildPageJsonLd } from "@/lib/jsonld";
import { getSiteConfig } from "@/lib/config";

/** Bangla About page — `/about`. */
export function generateMetadata(): Metadata {
  return aboutMetadata("bn");
}

export default function AboutPage() {
  const data = getAboutData();
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;

  const jsonLd = buildPageJsonLd({
    site,
    url: `${base}/about`,
    name: "সম্পর্কে",
    description: site.seo?.description || site.description,
  });

  return (
    <>
      <JsonLd data={jsonLd} />
      <AboutView locale="bn" {...data} />
    </>
  );
}
