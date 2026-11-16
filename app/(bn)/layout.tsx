import type { Metadata } from "next";
import "../globals.css";
import { RootShell } from "@/components/layouts/RootShell";
import { MainChrome } from "@/components/layouts/MainChrome";
import { buildRootMetadata } from "@/lib/root-metadata";
import { getSiteConfig } from "@/lib/config";

/** The Bangla public site, served from the root URL. */
export async function generateMetadata(): Promise<Metadata> {
  return buildRootMetadata();
}

export default function BanglaRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const site = getSiteConfig();
  const baseUrl = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  const logoUrl = site.logo
    ? site.logo.startsWith("http")
      ? site.logo
      : `${baseUrl}${site.logo.startsWith("/") ? site.logo : `/${site.logo}`}`
    : "";

  const siteJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${baseUrl}/#website`,
        url: baseUrl,
        name: site.seo?.siteName || site.title,
        description: site.seo?.description || site.description,
        inLanguage: ["bn-BD", "en-US"],
        publisher: { "@id": `${baseUrl}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${baseUrl}/?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        "@id": `${baseUrl}/#organization`,
        name: site.seo?.organization?.name || site.title,
        url: baseUrl,
        ...(logoUrl
          ? {
              logo: {
                "@type": "ImageObject",
                url: logoUrl,
              },
            }
          : {}),
      },
    ],
  };

  return (
    <RootShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
      />
      <MainChrome locale="bn">{children}</MainChrome>
    </RootShell>
  );
}
