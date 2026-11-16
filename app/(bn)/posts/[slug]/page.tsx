import { permanentRedirect, notFound } from "next/navigation";
import { getPostBySlugAsync } from "@/lib/posts";
import { resolveLegacyStoryPath } from "@/lib/routes/story";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return [];
}

export default async function OldPostRedirect({ params }: Props) {
  const { slug } = await params;

  // Redirect straight to the canonical public URL in one hop. Bouncing
  // through `/${slug}` first would make this a two-step redirect, and the
  // intermediate hop would render a full page for every request.
  const legacyPath = await resolveLegacyStoryPath(slug);
  if (legacyPath) permanentRedirect(legacyPath);

  const post = await getPostBySlugAsync(slug);
  // Legacy URL. An unknown slug gets a real 404 — bouncing it to the
  // homepage would hand Google a 200 for every guessed /posts/<garbage>.
  if (!post) notFound();
  permanentRedirect(`/${post.slug}`);
}