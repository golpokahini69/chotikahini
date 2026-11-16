import type { Metadata } from "next";
import { postsMetadata } from "@/lib/routes/posts";
import { PostsView } from "@/components/pages/PostsView";

/** Bangla community posts page — `/posts`. */
export const revalidate = 30;

export function generateMetadata(): Metadata {
  return postsMetadata("bn");
}

export default async function PostsPage() {
  return <PostsView locale="bn" />;
}
