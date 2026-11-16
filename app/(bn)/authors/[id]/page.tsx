import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Globe, Mail, ExternalLink, Calendar, Clock, MessageCircle, BadgeCheck } from "lucide-react";
import { getAuthors, getSiteConfig } from "@/lib/config";
import { canonicalAuthorSlug, getAuthorPosts, resolveAuthor, uniqueAuthorName } from "@/lib/authors";

import { getAllPostsAsync } from "@/lib/posts";
import { PostGridWithAds } from "@/components/PostGridWithAds";
import { buildMetadata } from "@/lib/metadata";
import { formatDate , enToBnNumber} from '@/lib/utils';
import { FollowAuthorButton } from "@/components/FollowAuthorButton";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { SectionIcon } from "@/components/SectionIcon";
import { JsonLd } from "@/components/JsonLd";
import { buildListingJsonLd } from "@/lib/jsonld";

interface Props {
  params: Promise<{ id: string }>;
}

export function generateStaticParams() {
  return getAuthors().map((author) => ({ id: author.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // Resolve against the DB so the title carries the author's real name.
  // The previous implementation used the client-safe `getAuthor()`, which
  // fabricates "অজ্ঞাত লেখক" for any unknown id — that gave every
  // anonymous author the identical title, so Google could only index one
  // of them.
  const { id } = await params;
  const resolved = await resolveAuthor(id);
  if (!resolved) return {};

  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  const displayName = uniqueAuthorName(resolved, id);
  // The canonical URL is always the username form, so the DB-id form
  // (which post cards link to) and the username form (which the /authors
  // index links to) do not both compete to be indexed.
  const slug = canonicalAuthorSlug(resolved, id);

  // An author with no published stories renders only a profile card —
  // a soft 404. Keep it reachable but out of the index.
  const posts = await getAuthorPosts(resolved, id);

  return buildMetadata({
    title: `${displayName} — ${site.title}`,
    description:
      resolved.bio ||
      `${displayName} — ${site.description || site.seo?.description}`,
    url: `${base}/authors/${encodeURIComponent(slug)}`,
    robots: posts.length === 0 ? "noindex, follow" : "index, follow",
    skipKeywordTitle: true,
  });
}

export default async function AuthorPage({ params }: Props) {
  const { id } = await params;
  // The shared resolver in lib/authors.ts checks the DB first and falls
  // back to the legacy static list. It returns null when the id is in
  // neither — that is the 404 case.
  //
  // `getAuthor()` in lib/config.ts is deliberately NOT used here: it never
  // returns null and fabricates an "অজ্ঞাত লেখক" profile for any unknown
  // id, which made every /authors/<anything> an indexable 200 page with a
  // placeholder profile — a soft-404 factory.
  const resolved = await resolveAuthor(id);
  if (!resolved) notFound();

  // An author is reachable under two different URL segments — their
  // relational DB id and their `username` slug — and both render the
  // same profile with the same title. Internal links disagreed about
  // which one to use (post cards used the id, the /authors index and the
  // sidebar used the username), so Google had two candidate URLs per
  // person and could only index one.
  //
  // The username is the canonical form. Redirect the id form to it so
  // every author has exactly one indexable URL.
  const canonicalSlug = canonicalAuthorSlug(resolved, id);
  if (canonicalSlug !== id) {
    redirect(`/authors/${encodeURIComponent(canonicalSlug)}`);
  }

  const site = getSiteConfig();
  const isVerified = resolved.isVerified;
  const displayName = uniqueAuthorName(resolved, id);

  const author = {
    id: resolved.username || resolved.id,
    name: displayName,
    image: resolved.image,
    bio:
      resolved.bio ||
      `${displayName} - ${site.title} কমিউনিটি সদস্য`,
    facebook: "",
    website: "",
  };

  // Posts reference the relational DB id (s.author_id). The URL param can
  // be either that id or the author's `username` slug, so collect both keys
  // and filter locally — keeps a single `getAllPostsAsync` round-trip.
  const posts = await getAuthorPosts(resolved, id);

  // An author with no published stories renders only a profile card and an
  // "এই লেখকের কোনো লেখা নেই" line. That is a soft 404 — thin content at
  // an indexable URL. Google reads it as a low-quality page and drops it
  // from the index anyway, but it still consumes crawl budget and it
  // competes with the pages that deserve to rank.
  //
  // The page is kept reachable (the /authors index links to it, and a
  // visitor may arrive from an old link) but it is marked noindex and it
  // is excluded from the sitemap.
  const isThin = posts.length === 0;

  return (
    <div className="container-page py-10 sm:py-14">
      <JsonLd
        data={buildListingJsonLd({
          site: getSiteConfig(),
          url: `${getSiteConfig().url.endsWith("/") ? getSiteConfig().url.slice(0, -1) : getSiteConfig().url}/authors/${id}`,
          name: author.name,
          description: author.bio || `${author.name} — লেখক`,
          items: posts.map((p) => ({
            url: `${getSiteConfig().url.endsWith("/") ? getSiteConfig().url.slice(0, -1) : getSiteConfig().url}/${p.uid || p.slug}`,
            name: p.title,
            image: p.cover || null,
          })),
          breadcrumb: [{ name: "লেখকবৃন্দ", url: `${getSiteConfig().url.endsWith("/") ? getSiteConfig().url.slice(0, -1) : getSiteConfig().url}/authors` }],
        })}
      />
      {/* Author profile card — modern gradient hero */}
      <div className="relative overflow-hidden rounded-3xl border border-border bg-surface-alt mb-10">
        {/* Decorative gradient */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-accent/8 via-transparent to-blue-500/8 dark:from-accent/10 dark:to-blue-500/10" />
        <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-accent/5 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 rounded-full bg-blue-500/5 blur-3xl pointer-events-none" />

        <div className="relative p-6 sm:p-10">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 sm:gap-8 text-center sm:text-left">
            {/* Avatar */}
            {author.image ? (
              <div className="relative shrink-0">
                <Image
                  src={author.image || "/images/avatars/1.jpg"}
                  alt={author.name}
                  width={112}
                  height={112}
                  className="w-28 h-28 sm:w-32 sm:h-32 rounded-full object-cover aspect-square overflow-hidden ring-4 ring-accent/15 shadow-xl"
                />
                {isVerified && (
                  <span className="absolute -bottom-1 -right-1 bg-surface-alt rounded-full p-1 ring-2 ring-surface-alt">
                    <VerifiedBadge size="lg" />
                  </span>
                )}
              </div>
            ) : (
              <div className="relative shrink-0">
                <span
                  className="flex items-center justify-center rounded-full overflow-hidden bg-gradient-to-br from-accent to-accent-hover text-surface text-4xl sm:text-5xl font-bold ring-4 ring-accent/15 shadow-xl"
                  style={{ height: "7rem", width: "7rem" }}
                >
                  {author.name.charAt(0)}
                </span>
                {isVerified && (
                  <span className="absolute -bottom-1 -right-1 bg-surface-alt rounded-full p-1 ring-2 ring-surface-alt">
                    <VerifiedBadge size="lg" />
                  </span>
                )}
              </div>
            )}

            {/* Info */}
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg flex items-center gap-2 justify-center sm:justify-start">
                {author.name}
                {isVerified && <span className="hidden sm:inline"><VerifiedBadge size="lg" /></span>}
              </h1>

              {author.bio && (
                <p className="text-sm text-fg-muted leading-relaxed mt-2 max-w-2xl">
                  {author.bio}
                </p>
              )}

              {/* Stats row */}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5 mt-5">
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs text-fg-subtle">
                  <SectionIcon seed={author.id} className="h-9 w-9 shrink-0" />
                  <span className="font-bold text-fg">{enToBnNumber(posts.length)}</span> লেখা
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs text-fg-subtle">
                  <Calendar className="h-3.5 w-3.5" />
                  <span className="font-bold text-fg">সক্রিয়</span> লেখক
                </span>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5 mt-4">
                <FollowAuthorButton authorId={author.id} />
                <Link
                  href={`/chat?userId=${author.id}`}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-accent text-surface font-semibold px-4 py-2 text-xs hover:opacity-90 transition-all shadow-sm"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  মেসেজ পাঠান
                </Link>
                {author.website && (
                  <a
                    href={author.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-xs text-fg-subtle hover:text-fg hover:border-fg/30 transition-colors"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    ওয়েবসাইট
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {author.facebook && (
                  <a
                    href={author.facebook}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-xs text-fg-subtle hover:text-fg hover:border-fg/30 transition-colors"
                  >
                    <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                    ফেসবুক
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Posts using card-grid (same as homepage) */}
      {posts.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-border bg-surface-alt">
          <p className="text-sm text-fg-muted">এই লেখকের কোনো লেখা নেই</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-5">
            <span className="h-1 w-1 rounded-full bg-fg" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
              লেখাসমূহ
            </h2>
          </div>
          <PostGridWithAds posts={posts} adInterval={4} />
        </>
      )}
    </div>
  );
}
