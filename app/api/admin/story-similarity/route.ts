import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { preprocessForSimilarity, scorePreprocessed } from "@/lib/similarity";
import { CACHE_TAGS, cachedRead } from "@/lib/cache";

export const dynamic = "force-dynamic";

// GET /api/admin/story-similarity
// For every story returns the highest similarity % against any OTHER
// story, plus the matched story title. Admins/authors use this to spot
// duplicates.

/**
 * The full pairwise scan is O(n²) over every story body (the query pulls
 * ~7 MB of `content` for the catalogue), so the result is cached for 10
 * minutes in the SHARED Data Cache — a process-local memo like before died
 * with every serverless instance and made each cold dashboard pay the whole
 * scan again.
 *
 * The cache is keyed by SCOPE:
 *   • `"all"`  — reviewer roles (they may see every story);
 *   • `<user id>` — authors, whose result must contain only THEIR stories.
 * The old single process-local slot served whichever scope computed first
 * to EVERYONE, so an author could receive another author's results.
 */
const computeSimilarity = cachedRead(
  "admin-story-similarity",
  async (scope: string): Promise<{ results: any[]; total: number }> => {
    const supabase = getSupabaseAdmin();

    let query = supabase
      .from("stories")
      .select("uid, slug, title, content, author_id, status")
      .limit(5000);

    if (scope !== "all") {
      query = query.eq("author_id", scope);
    }

    const { data: stories } = await query;
    if (!stories || stories.length === 0) {
      return { results: [], total: 0 };
    }

    // Pre-process each story's n-grams once
    const prepared = (stories as any[]).map((s) => ({
      uid: s.uid,
      slug: s.slug,
      title: s.title,
      status: s.status,
      authorId: s.author_id,
      text: preprocessForSimilarity(s.content || ""),
    }));

    const results: any[] = [];

    for (let i = 0; i < prepared.length; i++) {
      const a = prepared[i];
      if (a.text.bigramSet.size < 5) {
        // Very short text — can't judge similarity meaningfully
        results.push({ uid: a.uid, slug: a.slug, title: a.title, status: a.status, maxSimilarity: 0, matched: null });
        continue;
      }

      let best = 0;
      let bestMatch: any = null;

      for (let j = 0; j < prepared.length; j++) {
        if (i === j) continue;
        const b = prepared[j];
        if (b.text.bigramSet.size < 5) continue;
        const score = scorePreprocessed(a.text, b.text);
        if (score > best) {
          best = score;
          bestMatch = { uid: b.uid, slug: b.slug, title: b.title };
        }
      }

      results.push({
        uid: a.uid,
        slug: a.slug,
        title: a.title,
        status: a.status,
        maxSimilarity: Math.round(best * 100),
        matched: bestMatch,
      });
    }

    return { results, total: prepared.length };
  },
  {
    revalidate: 600, // 10 minutes — same freshness window as before
    keyParts: ([scope]) => [scope],
    tags: [CACHE_TAGS.posts],
  },
);

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Any author-tier role can see similarity for their own stories.
    const canSeeAll = hasPermission(session.role, "story.review");
    if (session.role === "user" || (!canSeeAll && session.role !== "author")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const scope = canSeeAll ? "all" : String(session.id);
    const data = await computeSimilarity(scope);
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
