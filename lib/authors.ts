/**
 * lib/authors.ts — server-side author resolution.
 *
 * An author page can be addressed by either the author's relational DB id
 * or their `username` slug, and the *same* author can be reached under
 * both. That means the id alone is not a safe title input: two different
 * URLs can resolve to the same person, and two different people can share
 * a generic name.
 *
 * `getAuthor()` in lib/config.ts is a client-safe helper that never
 * returns null — for an unknown id it fabricates an "অজ্ঞাত লেখক"
 * profile. Using it for metadata therefore gave every anonymous author
 * the identical title "অজ্ঞাত লেখক — বাংলা চটি গল্প | Chotikahini",
 * which Google reads as one page wearing eleven hats: only one of them
 * can ever be indexed.
 *
 * This module resolves an author against the DB first and returns a
 * display name that is unique per page.
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import { getAuthor as getStaticAuthor, getAuthors } from "@/lib/config";

export interface ResolvedAuthor {
  /** The id used in the URL. */
  id: string;
  /** The person's display name, never the generic placeholder. */
  name: string;
  /** The username slug, when the author has one. */
  username: string | null;
  /** Profile picture URL. */
  image: string;
  /** Bio text. */
  bio: string;
  /** Whether the account is verified. */
  isVerified: boolean;
  /** Where the profile came from. */
  source: "db" | "static";
  /** True when the author has no usable display name at all. */
  isPlaceholder: boolean;
}

const PLACEHOLDER_NAME = "অজ্ঞাত লেখক";

/**
 * Resolve an author by id or username.
 *
 * Returns null when the id matches neither a DB user nor a static
 * config entry — the caller should 404 in that case.
 */
export async function resolveAuthor(
  id: string,
): Promise<ResolvedAuthor | null> {
  const key = (id || "").trim();
  if (!key) return null;

  // 1. The database is the source of truth for real accounts.
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("users")
      .select("id, username, name, profile_pic, bio, is_verified")
      .or(`id.eq.${key},username.eq.${key}`)
      .maybeSingle();

    if (!error && data) {
      const name = (data.name || "").trim();
      const username = (data.username || "").trim();
      const displayName = name || username;
      return {
        id: data.id,
        name: displayName || PLACEHOLDER_NAME,
        username: username || null,
        image: data.profile_pic || "",
        bio: data.bio || "",
        isVerified: data.is_verified === true,
        source: "db",
        // A DB row with neither a name nor a username is a placeholder
        // — its title would still collide with every other one.
        isPlaceholder: !displayName,
      };
    }
  } catch {
    // Fall through to the static list.
  }

  // 2. Legacy static authors (slugs like "proyash", "roki").
  const staticAuthor = getAuthors().find(
    (a) => a.id.toLowerCase() === key.toLowerCase(),
  );
  if (staticAuthor) {
    return {
      id: staticAuthor.id,
      name: staticAuthor.name,
      username: staticAuthor.id,
      image: staticAuthor.image || "",
      bio: staticAuthor.bio || "",
      isVerified: false,
      source: "static",
      isPlaceholder: false,
    };
  }

  return null;
}

/**
 * A display name that is guaranteed to differ between two different
 * authors, even when both are anonymous.
 *
 * Anonymous authors fall back to their URL id, which is unique by
 * construction. This keeps every author page's <title> distinct, so
 * Google can index them separately instead of collapsing them into one.
 */
export function uniqueAuthorName(
  author: ResolvedAuthor,
  urlId: string,
): string {
  if (!author.isPlaceholder && author.name && author.name !== PLACEHOLDER_NAME) {
    return author.name;
  }
  // Use the username if there is one, otherwise the raw URL id.
  return author.username || urlId;
}

/**
 * The canonical URL segment for an author.
 *
 * An author can be addressed by their relational DB id *or* their
 * `username` slug, and both resolve to the same person — the same stories,
 * the same display name, the same title. That is a duplicate-content
 * signal: Google picks one and drops the other, and the pages that are
 * linked internally (post cards use the DB id, the /authors index and
 * the sidebar use the username) disagree about which one that is.
 *
 * The username is the stable, human-readable form, so it is canonical.
 * The DB id form keeps working and redirects to it.
 */
export function canonicalAuthorSlug(
  author: ResolvedAuthor,
  urlId: string,
): string {
  const username = author.username?.trim();
  if (username) return username;
  return urlId;
}

/**
 * Every key a story might use to reference this author.
 *
 * Stories store the relational DB id, while the URL may carry the
 * username slug (or the other way round), so both have to be matched.
 */
export function authorPostKeys(
  author: ResolvedAuthor,
  urlId: string,
): Set<string> {
  const keys = new Set<string>();
  const push = (v?: string | null) => {
    const k = (v || "").toString().toLowerCase().trim();
    if (k) keys.add(k);
  };
  push(urlId);
  push(author.id);
  push(author.username);
  push(author.id);
  return keys;
}

/**
 * The published stories of an author.
 */
export async function getAuthorPosts(
  author: ResolvedAuthor,
  urlId: string,
) {
  const { getAllPostsAsync } = await import("@/lib/posts");
  const allPosts = await getAllPostsAsync();
  const keys = authorPostKeys(author, urlId);
  return allPosts.filter((p) =>
    keys.has((p.authorId || "").toString().toLowerCase().trim())
  );
}
