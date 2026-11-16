import { permanentRedirect, notFound } from "next/navigation";
import { getPostBySlugAsync } from "@/lib/posts";
import { resolveLegacyStoryPath } from "@/lib/routes/story";
import { getSiteConfig } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildMetadata } from "@/lib/metadata";
import type { Metadata } from "next";
import PostDetailClient from "./PostDetailClient";

interface Props {
  params: Promise<{ slug: string }>;
}

/** Whether a community post with this numeric id exists and is published. */
async function communityPostExists(postId: string): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("posts")
      .select("id")
      .eq("id", Number(postId))
      .eq("status", "published")
      .maybeSingle();
    return !!data;
  } catch {
    // If the lookup itself fails we cannot prove absence — render the page
    // rather than 404 a post that may well exist.
    return true;
  }
}

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const site = getSiteConfig();
  const { slug } = await params;

  if (!isNaN(Number(slug))) {
    try {
      const supabase = getSupabaseAdmin();
      const { data: raw } = await supabase
        .from("posts")
        .select("id, content, likes_count, reposts_count, comments_count, created_at, users:user_id ( username, name )")
        .eq("id", Number(slug))
        .eq("status", "published")
        .maybeSingle();

      if (raw) {
        const u = Array.isArray(raw.users) ? raw.users[0] : raw.users;
        const authorName = u?.name || u?.username || "";
        const desc = (raw.content || "").slice(0, 200).replace(/\s+/g, " ").trim();
        const title = `@${u?.username || ""} এর পোস্ট`;
        const baseUrl = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;

        return buildMetadata({
          title,
          description: desc || "পোস্ট দেখুন",
          url: `${baseUrl}/post/${slug}`,
          type: "article",
          robots: "index, follow",
        });
      }
    } catch (e) {}

    return { title: `পোস্ট #${slug} | ${site.title}` };
  }

  return { title: site.title };
}

export default async function PostDetailPage({ params }: Props) {
  const { slug } = await params;

  if (!isNaN(Number(slug))) {
    // The detail view is fetched client-side, but the existence check has
    // to happen on the server: otherwise every /post/<number> — including
    // numbers that do not exist — answers 200 with an empty shell, which is
    // a soft 404 the crawler happily indexes.
    const exists = await communityPostExists(slug);
    if (!exists) notFound();
    return <PostDetailClient postId={slug} />;
  }

  const post = await getPostBySlugAsync(slug);
  // An unknown slug is not a page. Redirecting to the homepage turned every
  // typo'd URL into an indexable 200; a real 404 is the correct answer.
  if (!post) notFound();

  // Redirect straight to the canonical public URL in one hop. Bouncing
  // through `/${slug}` first would make this a two-step redirect, and the
  // intermediate hop would render a full page for every request.
  const legacyPath = await resolveLegacyStoryPath(slug);
  if (legacyPath) permanentRedirect(legacyPath);

  permanentRedirect(`/${post.slug}`);
}