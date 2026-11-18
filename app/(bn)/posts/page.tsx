import type { Metadata } from "next";
import { postsMetadata } from "@/lib/routes/posts";
import { PostsView } from "@/components/pages/PostsView";

/** Bangla community posts page — `/posts`. */
// ISR budget: was 30s. Vercel Hobby caps ISR writes at
// 200K/30d and this route was regenerating far too often. Publishes purge
// these paths on demand (revalidatePath), so the timer is only a fallback.
export const revalidate = 21600;

export function generateMetadata(): Metadata {
  return postsMetadata("bn");
}

export default async function PostsPage() {
  return <PostsView locale="bn" />;
}
