import type { MetadataRoute } from "next";
import { getSiteConfig, isPictureSectionEnabled } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  const site = getSiteConfig();
  const baseUrl = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;

  // Private, non-content and duplicate URLs.
  //
  // `/admin` and the auth/chat/user APIs are private. `/search`, `/chat` and
  // `/profile` are app surfaces with no standalone content worth indexing —
  // they are thin, session-driven shells. The legacy `/post`, `/posts/<slug>`
  // and `/read/<slug>` paths are permanent redirects onto the canonical
  // story URL, so there is no reason to spend crawl budget on them.
  const disallow = [
    "/admin/",
    "/api/",
    "/auth/",
    "/chat",
    "/profile",
    "/search",
    "/post/",
    "/posts/",
    "/read/",
  ];
  if (!isPictureSectionEnabled()) {
    disallow.push("/pictures", "/pictures/");
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/rss.xml",
          "/rss-pictures.xml",
          "/sitemap.xml",
          "/api/og/",
        ],
        disallow,
      },
      {
        userAgent: [
          "Bytespider",
          "PetalBot",
          "MJ12bot",
          "DotBot",
          "DataForSeoBot",
          "Amazonbot",
        ],
        disallow: ["/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
