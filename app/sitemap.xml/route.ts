import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getAllPostsAsync, getSeries } from "@/lib/posts";
import { getSiteConfig, getAllCategoryConfigs, isPictureSectionEnabled, isVideoSectionEnabled } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/supabase";
import { tagSlug } from "@/lib/tag-utils";
import { getSeriesId } from "@/lib/series-utils";
import { getArchiveTreeAsync } from "@/lib/archive";
import { POSTS_PER_PAGE } from "@/lib/constants";
import { CACHE_TAGS } from "@/lib/cache";

export const revalidate = 86400; // 24 hour edge cache

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return c;
    }
  });
}

const buildSitemapXmlCached = unstable_cache(
  async (): Promise<string> => {
    const site = getSiteConfig();
    const baseUrl = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;

    let posts: any[] = [];
    let seriesList: Awaited<ReturnType<typeof getSeries>> = [];
    try {
      posts = await getAllPostsAsync();
      seriesList = await getSeries();
    } catch (err) {
      console.error("[sitemap] Failed to fetch posts:", err);
    }

    const categories = getAllCategoryConfigs();

  // Aggregate tags directly from posts without a second DB roundtrip.
  //
  // The key is normalised to NFC because `tagSlug()` normalises to NFC too.
  // Without this, the same Bengali word stored in two different Unicode
  // forms produced two identical `<loc>` values in the sitemap.
  const tagMap = new Map<string, number>();
  for (const post of posts) {
    if (Array.isArray(post.tags)) {
      for (const t of post.tags) {
        const norm = t?.trim().normalize("NFC");
        if (norm) tagMap.set(norm, (tagMap.get(norm) || 0) + 1);
      }
    }
  }

  // The Bangla site is the only published locale, so each path is emitted once.
  type SitemapEntry = {
    /** Path relative to the site root, without a locale prefix (e.g. "/about"). */
    path: string;
    lastmod?: string;
    changefreq?: string;
    priority: number;
  };

  const entries: SitemapEntry[] = [
    { path: "", changefreq: "daily", priority: 1.0 },
    { path: "/series", changefreq: "daily", priority: 0.8 },
    { path: "/authors", changefreq: "weekly", priority: 0.5 },
    { path: "/featured", changefreq: "daily", priority: 0.7 },
    { path: "/categories", changefreq: "weekly", priority: 0.6 },
    { path: "/archive", changefreq: "weekly", priority: 0.5 },
    { path: "/about", changefreq: "monthly", priority: 0.4 },
    { path: "/contact", changefreq: "monthly", priority: 0.3 },
    { path: "/privacy", changefreq: "yearly", priority: 0.2 },
    { path: "/tags", changefreq: "weekly", priority: 0.5 },
  ];

  // Paginated story listing — `/page/2`, `/page/3`, …
  //
  // Page 1 is the homepage, so the paginated route starts at 2. Only real
  // pages are listed; an out-of-range number now returns a 404 and must not
  // appear here.
  const totalPosts = posts.length;
  const totalPostPages = Math.ceil(totalPosts / POSTS_PER_PAGE);
  for (let p = 2; p <= totalPostPages; p++) {
    entries.push({
      path: `/page/${p}`,
      changefreq: "daily",
      priority: 0.6,
    });
  }

  // Archive months — `/archive/2026/11`
  try {
    const tree = await getArchiveTreeAsync();
    for (const year of tree) {
      for (const month of year.months) {
        entries.push({
          path: `/archive/${year.year}/${String(month.month).padStart(2, "0")}`,
          changefreq: "monthly",
          priority: 0.4,
        });
      }
    }
  } catch (err) {
    console.error("[sitemap] Failed to build archive tree:", err);
  }

  for (const series of seriesList) {
    entries.push({
      path: `/series/${getSeriesId(series)}`,
      lastmod: series[0]?.updatedAt ? new Date(series[0].updatedAt).toISOString() : undefined,
      changefreq: "weekly",
      priority: 0.7,
    });
  }

  // Categories.
  //
  // Only categories that actually have published stories are listed. A
  // category with zero stories renders an empty grid at HTTP 200 — a soft
  // 404 — and its metadata is `noindex, follow`. Listing it in the sitemap
  // would invite Google to crawl a page we are simultaneously telling it
  // not to index, which is a contradictory signal.
  const categoryCounts = new Map<string, number>();
  for (const post of posts) {
    const id = (post.categoryId || "").trim();
    if (id) categoryCounts.set(id, (categoryCounts.get(id) || 0) + 1);
  }
  for (const c of categories) {
    if ((categoryCounts.get(c.id) || 0) === 0) {
      console.warn(`[sitemap] Skipping empty category: ${c.id}`);
      continue;
    }
    entries.push({
      path: `/categories/${c.id}`,
      changefreq: "daily",
      priority: 0.7,
    });
  }

  // Posts
  for (const post of posts) {
    const id = post.uid || post.slug;
    const priority = post.featured ? 0.9 : 0.8;
    // Stories published after the public-slug rollout live at
    // `/golpo/<public-slug>`; older ones keep their `/{uid}` URL.
    entries.push({
      path: post.publicSlug ? `/golpo/${post.publicSlug}` : `/${id}`,
      lastmod: post.updatedAt ? new Date(post.updatedAt).toISOString() : new Date().toISOString(),
      changefreq: priority >= 0.9 ? "weekly" : "monthly",
      priority,
    });
  }

  // Tags with >= 2 posts
  for (const [tag, count] of tagMap.entries()) {
    if (count >= 2) {
      entries.push({
        path: `/tags/${tagSlug(tag)}`,
        changefreq: "weekly",
        priority: 0.5,
      });
    }
  }

  // Author archives.
  //
  // Only authors that actually have published stories are listed: an author
  // page with no stories is a thin page, and the route now 404s for an id
  // that is neither a known author nor a DB user. The `/authors` index above
  // links to every one of these, so they are not orphan pages.
  //
  // The URL segment is the author's `username`, not the relational DB id.
  // An author is reachable under both, and both render the same profile
  // with the same title — two indexable URLs per person. The DB-id form
  // now 308-redirects to the username form, so only the username is
  // listed here and in the sitemap.
  const authorIds = new Set<string>();
  for (const post of posts) {
    if (post.authorId) authorIds.add(String(post.authorId));
  }
  if (authorIds.size > 0) {
    try {
      const { data: users } = await getSupabaseAdmin()
        .from("users")
        .select("id, username");
      const usernameById = new Map<string, string>();
      for (const u of users || []) {
        if (u?.id && u?.username) usernameById.set(u.id, u.username);
      }
      for (const id of authorIds) {
        const slug = usernameById.get(id) || id;
        entries.push({
          path: `/authors/${encodeURIComponent(slug)}`,
          changefreq: "weekly",
          priority: 0.5,
        });
      }
    } catch (err) {
      console.error("[sitemap] Failed to resolve author usernames:", err);
      for (const id of authorIds) {
        entries.push({
          path: `/authors/${encodeURIComponent(id)}`,
          changefreq: "weekly",
          priority: 0.5,
        });
      }
    }
  }

  // Picture galleries — only when the section is switched on, so a
  // disabled section drops out of the index entirely.
  if (isPictureSectionEnabled()) {
    entries.push({
      path: "/pictures",
      changefreq: "daily",
      priority: 0.8,
    });

    try {
      // `public_slug` is optional — see scripts/media-slugs.sql. If the
      // column isn't there yet, fall back to the old `id`-only listing.
      const buildQuery = (columns: string) =>
        getSupabaseAdmin()
          .from("picture_galleries")
          .select(columns)
          .eq("status", "published")
          .not("cover_url", "is", null)
          .lte("published_at", new Date().toISOString())
          .order("published_at", { ascending: false })
          .limit(500);

      let result = await buildQuery("id, public_slug, published_at, updated_at");
      if (result.error) {
        const message = result.error.message ?? "";
        if (
          result.error.code === "42703" ||
          result.error.code === "PGRST204" ||
          /column .* does not exist|could not find the .* in the schema cache/i.test(
            message,
          )
        ) {
          result = await buildQuery("id, published_at, updated_at");
        }
      }

      const { data: galleries, error } = result;
      const galleryRows = ((galleries ?? []) as unknown as Array<{
        id: string;
        public_slug?: string | null;
        published_at: string | null;
        updated_at: string | null;
      }>);
      if (!error && galleryRows.length > 0) {
        for (const gallery of galleryRows) {
          // Galleries published after the public-slug rollout live at
          // `/image/<public-slug>`; older ones keep `/pictures/<uuid>`.
          const slug = (gallery as any).public_slug as string | null | undefined;
          entries.push({
            path: slug ? `/image/${slug}` : `/pictures/${gallery.id}`,
            lastmod: gallery.updated_at
              ? new Date(gallery.updated_at).toISOString()
              : gallery.published_at
                ? new Date(gallery.published_at).toISOString()
                : undefined,
            changefreq: "weekly",
            priority: 0.7,
          });
        }
      }
    } catch (err) {
      console.error("[sitemap] Failed to fetch picture galleries:", err);
    }
  }

  // Video section — only when the section is switched on.
  if (isVideoSectionEnabled()) {
    entries.push({
      path: "/videos",
      changefreq: "daily",
      priority: 0.7,
    });

    try {
      // `public_slug` is optional — see scripts/media-slugs.sql. If the
      // column isn't there yet, fall back to the old `id`-only listing.
      const buildQuery = (columns: string) =>
        getSupabaseAdmin()
          .from("video_posts")
          .select(columns)
          .eq("status", "published")
          .not("embed_url", "is", null)
          .lte("published_at", new Date().toISOString())
          .order("published_at", { ascending: false })
          .limit(500);

      let result = await buildQuery("id, public_slug, published_at, updated_at");
      if (result.error) {
        const message = result.error.message ?? "";
        if (
          result.error.code === "42703" ||
          result.error.code === "PGRST204" ||
          /column .* does not exist|could not find the .* in the schema cache/i.test(
            message,
          )
        ) {
          result = await buildQuery("id, published_at, updated_at");
        }
      }

      const { data: videos, error } = result;
      const videoRows = ((videos ?? []) as unknown as Array<{
        id: string;
        public_slug?: string | null;
        published_at: string | null;
        updated_at: string | null;
      }>);
      if (!error && videoRows.length > 0) {
        for (const video of videoRows) {
          // Videos published after the public-slug rollout live at
          // `/video/<public-slug>`; older ones keep `/videos/<uuid>`.
          const slug = (video as any).public_slug as string | null | undefined;
          entries.push({
            path: slug ? `/video/${slug}` : `/videos/${video.id}`,
            lastmod: video.updated_at
              ? new Date(video.updated_at).toISOString()
              : video.published_at
                ? new Date(video.published_at).toISOString()
                : undefined,
            changefreq: "weekly",
            priority: 0.6,
          });
        }
      }
    } catch (err) {
      console.error("[sitemap] Failed to fetch videos:", err);
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map((e) => {
    const loc = `${baseUrl}${e.path}`;
    return `  <url>
    <loc>${escapeXml(loc)}</loc>${e.lastmod ? `\n    <lastmod>${e.lastmod}</lastmod>` : ""}${e.changefreq ? `\n    <changefreq>${e.changefreq}</changefreq>` : ""}
    <priority>${e.priority.toFixed(1)}</priority>
  </url>`;
  })
  .join("\n")}
</urlset>`;

    return xml;
  },
  ["sitemap-xml-content"],
  { revalidate: 86400, tags: [CACHE_TAGS.posts, "sitemap"] }
);

export async function GET() {
  const xml = await buildSitemapXmlCached();

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
