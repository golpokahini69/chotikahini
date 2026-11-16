#!/usr/bin/env node
/**
 * Backfill `public_slug` for content published before the public-slug
 * rollout — stories, videos and picture galleries.
 *
 * Why
 * ---
 * `scripts/media-slugs.sql` deliberately leaves existing rows empty:
 * "content published before this change keeps its old URL". That keeps
 * the old URL *working* — but it also means the old URL never *redirects*
 * to the new one, because the redirect is driven by `public_slug`:
 *
 *   app/(bn)/[slug]/page.tsx       → resolveLegacyStoryPath()
 *   app/(bn)/read/[slug]/page.tsx  → resolveLegacyStoryPath()
 *   app/(bn)/post/[slug]/page.tsx  → resolveLegacyStoryPath()
 *   app/(bn)/posts/[slug]/page.tsx → resolveLegacyStoryPath()
 *
 * With `public_slug` NULL those routes have nothing to redirect to, so
 * an old shared link keeps rendering the story at the old address. This
 * script fills the column in so the redirects start firing.
 *
 * Both URLs keep working after the backfill — the old one 308s to the
 * new one, and the new one renders the story directly. Nothing is
 * broken; the old address just stops being the final destination.
 *
 * The slug is minted from the title and is unique *within its own
 * table*, exactly like a freshly published item (see
 * `lib/public-slug-assign.ts`). An item that already has a slug is left
 * alone — the slug is fixed at publish time and must never change.
 *
 * Usage
 * -----
 *   node scripts/backfill-public-slugs.mjs              # dry run, all types
 *   node scripts/backfill-public-slugs.mjs --apply      # write to the DB
 *   node scripts/backfill-public-slugs.mjs --only=story # one type only
 *
 * The `--only` flag accepts: story, video, picture.
 *
 * Requires the same Supabase env vars the app uses:
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || null;
const BATCH_SIZE = 25;
const MAX_SLUG_LENGTH = 60;

/** Bengali Unicode block — a title in Bengali is translated to English. */
const HAS_BENGALI = /[\u0980-\u09ff]/;

/**
 * Strip diacritics and reduce a string to lowercase ASCII kebab-case.
 * Mirrors `toAsciiKebab` in lib/public-slug.ts.
 */
function toAsciiKebab(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build the slug base from a title.
 *
 * Bengali titles are translated to English first, so the slug reads as
 * English words ("dhaka-new-bridge") rather than Bengali characters.
 * A translation failure is not fatal — the title still has to produce
 * *a* slug, so the ASCII pass runs anyway and the fallback keyword is
 * used when it yields nothing.
 *
 * `fallbackBase` is the content type's own keyword ("golpo", "video",
 * "image") — the same fallback `lib/public-slug.ts` uses.
 */
async function titleToSlugBase(title, fallbackBase) {
  const cleanTitle = (title || "").trim();
  if (!cleanTitle) return fallbackBase;

  let candidate = cleanTitle;

  if (HAS_BENGALI.test(cleanTitle)) {
    try {
      const translated = await translateText(cleanTitle);
      if (translated && translated.trim()) candidate = translated;
    } catch (err) {
      console.warn(
        `  ! translation failed for "${cleanTitle.slice(0, 40)}" — ${err.message}`,
      );
    }
  }

  const slug = toAsciiKebab(candidate);
  if (!slug) return fallbackBase;
  if (slug.length <= MAX_SLUG_LENGTH) return slug;

  const clipped = slug.slice(0, MAX_SLUG_LENGTH);
  const lastDash = clipped.lastIndexOf("-");
  const trimmed = lastDash > 20 ? clipped.slice(0, lastDash) : clipped;
  return trimmed.replace(/-+$/g, "") || fallbackBase;
}

/**
 * Translate Bengali → English.
 *
 * Uses the same free Google Translate "GTX" endpoint as `lib/translate.ts`,
 * so the script produces exactly the slug the app would have produced.
 * A failure is not fatal — the title then falls through to the ASCII
 * pass, and an all-Bengali title lands on the fallback keyword.
 */
async function translateText(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=bn&tl=en&dt=t&q=${encodeURIComponent(text)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const translated = data[0].map((item) => item[0]).join("");
      if (translated) return translated;
    }
    throw new Error("unexpected response shape");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pick a slug that isn't already used by another story.
 *
 * `taken` is a Set of every slug already in the table — including the
 * ones this run has just assigned, so two stories sharing a headline
 * get `-1` and `-2` suffixes.
 */
function pickUniqueSlug(base, taken) {
  if (!taken.has(base)) return base;
  for (let n = 1; n <= 200; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The three content types, and everything that differs between them.
 *
 * `idColumn` is the column a slug is written against — `stories` is
 * keyed by its 14-digit `uid`, the two media tables by a uuid `id`.
 * `published` is the filter that finds live content: the story tables
 * carry a `status`, the media tables do not.
 */
const TYPES = {
  story: {
    table: "stories",
    idColumn: "uid",
    fallbackBase: "golpo",
    label: "stories",
    published: (q) => q.eq("status", "published"),
  },
  video: {
    table: "video_posts",
    idColumn: "id",
    fallbackBase: "video",
    label: "videos",
    published: (q) =>
      q.eq("status", "published").lte("published_at", new Date().toISOString()),
  },
  picture: {
    table: "picture_galleries",
    idColumn: "id",
    fallbackBase: "image",
    label: "picture galleries",
    published: (q) =>
      q.eq("status", "published").lte("published_at", new Date().toISOString()),
  },
};

async function main() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const kinds = ONLY ? [ONLY] : Object.keys(TYPES);
  for (const kind of kinds) {
    if (!TYPES[kind]) {
      throw new Error(
        `Unknown type "${kind}". Use one of: ${Object.keys(TYPES).join(", ")}.`,
      );
    }
  }

  console.log(
    APPLY
      ? "Backfilling public_slug (APPLY mode — this writes to the database)\n"
      : "Backfilling public_slug (dry run — pass --apply to write)\n",
  );

  let totalAssigned = 0;

  for (const kind of kinds) {
    totalAssigned += await backfillType(supabase, kind);
  }

  console.log(
    `\nDone. ${totalAssigned} slug(s) ${APPLY ? "written" : "would be written"}.`,
  );
  if (!APPLY) {
    console.log("Re-run with --apply to write these to the database.");
  }
}

/**
 * Backfill one content type.
 *
 * The three types are handled one after another rather than in
 * parallel: each one makes a translation call per row, and a large
 * table would otherwise open hundreds of requests at once and get the
 * translator to throttle them.
 */
async function backfillType(supabase, kind) {
  const type = TYPES[kind];

  // Every slug already in use for this type. Rows that already have a
  // slug keep it, so those are added to the set too and are never
  // re-assigned.
  const { data: allSlugs, error: slugError } = await supabase
    .from(type.table)
    .select("public_slug")
    .not("public_slug", "is", null);

  if (slugError) {
    throw new Error(
      `Could not read existing ${type.label} slugs — is scripts/media-slugs.sql applied? ${slugError.message}`,
    );
  }

  const taken = new Set((allSlugs || []).map((r) => r.public_slug));

  // Published rows with no slug yet.
  let query = supabase
    .from(type.table)
    .select(`${type.idColumn}, title`)
    .is("public_slug", null);
  query = type.published(query);

  const { data: rows, error } = await query;
  if (error) throw new Error(`Could not read ${type.label}: ${error.message}`);

  console.log(
    `── ${type.label} ──\n` +
      `  with a slug already : ${taken.size}\n` +
      `  to backfill         : ${(rows || []).length}`,
  );

  if (!rows || rows.length === 0) {
    console.log("  nothing to do\n");
    return 0;
  }

  let assigned = 0;
  let updates = [];

  for (const row of rows) {
    const base = await titleToSlugBase(row.title, type.fallbackBase);
    const slug = pickUniqueSlug(base, taken);
    taken.add(slug);
    updates.push({ id: row[type.idColumn], slug, title: row.title });

    assigned += 1;
    console.log(
      `  ${APPLY ? "" : "[dry-run] "}${slug.padEnd(40)}  ${(row.title || "").slice(0, 50)}`,
    );

    // Write in batches so a large table does not mean thousands of
    // individual round-trips.
    if (updates.length >= BATCH_SIZE) {
      await writeBatch(supabase, type, updates);
      updates = [];
    }
  }

  if (updates.length > 0) await writeBatch(supabase, type, updates);

  console.log("");
  return assigned;
}

async function writeBatch(supabase, type, updates) {
  if (!APPLY) return;

  for (const { id, slug } of updates) {
    const { error } = await supabase
      .from(type.table)
      .update({ public_slug: slug })
      .eq(type.idColumn, id);
    if (error) {
      console.error(`  ! failed to set ${id} → ${slug}: ${error.message}`);
    }
  }
}

main().catch((err) => {
  console.error("\nBackfill failed:", err.message);
  process.exit(1);
});
