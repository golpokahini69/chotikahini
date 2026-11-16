import { NextResponse } from "next/server";
import { mintPublicSlug } from "@/lib/public-slug-assign";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizeImages } from "@/lib/pictures";
import { pictureSourceKey } from "@/lib/picture-source-url";
import { resolvePublishState, resolveSchedulePatch } from "@/lib/media-schedule";
import { announcePicturePublished } from "@/lib/chat-system";
import { CACHE_TAGS, invalidateTags } from "@/lib/cache";

export const dynamic = "force-dynamic";

/**
 * Admin CRUD for picture galleries.
 *
 * Only URLs and metadata are stored — the image files stay on the
 * provider's CDN and are streamed from there, exactly like the video
 * section streams from a provider's player.
 */

async function authorize(permission: "media.upload" | "media.delete") {
  const session = await getSession();
  return session && hasPermission(session.role, permission) ? session : null;
}

/** Only https URLs are accepted — no http, no relative paths. */
function isHttpsUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("https://");
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Keep only non-empty strings, de-duplicated, order preserved. */
function cleanList(value: unknown, maxLength = 40): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const text = cleanText(entry).slice(0, maxLength);
    if (!text || out.includes(text)) continue;
    out.push(text);
  }
  return out;
}

/**
 * Did Postgres refuse the write because it broke a unique index?
 *
 * PostgREST reports this as code 23505. The constraint name is checked too
 * so a violation of some OTHER unique index is not misreported as a
 * duplicate gallery.
 */
function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  if (error.code !== "23505") return false;
  const message = error.message || "";
  return (
    message.includes("picture_galleries_source_key_uniq") ||
    message.includes("source_key")
  );
}

/**
 * Validate the incoming gallery payload.
 *
 * The `images` array is rebuilt here rather than trusted as-is: only https
 * URLs survive, and the thumbnail falls back to the full-size URL when it
 * is missing or malformed. That keeps a bad row from ever reaching the
 * public page.
 */
function parseGalleryPayload(body: any): {
  values: Record<string, any> | null;
  error: string | null;
} {
  const title = cleanText(body?.title).slice(0, 200);
  const description = cleanText(body?.description).slice(0, 500);
  const sourceUrl = cleanText(body?.sourceUrl);
  const coverUrl = cleanText(body?.coverUrl);
  const modelName = cleanText(body?.modelName).slice(0, 120);
  const channelName = cleanText(body?.channelName).slice(0, 120);

  const rawViews = Number(body?.sourceViews);
  const sourceViews =
    Number.isFinite(rawViews) && rawViews >= 0 ? Math.floor(rawViews) : null;

  if (!title) {
    return { values: null, error: "গ্যালারির শিরোনাম দিন।" };
  }
  if (!isHttpsUrl(sourceUrl)) {
    return { values: null, error: "গ্যালারির মূল লিংক (https://) দিন।" };
  }
  if (!isHttpsUrl(coverUrl)) {
    return { values: null, error: "কভার ছবির https লিংক দিন।" };
  }

  const images = normalizeImages(body?.images);
  if (images.length === 0) {
    return { values: null, error: "গ্যালারিতে অন্তত একটি ছবির লিংক দিন।" };
  }

  return {
    values: {
      title,
      description: description || null,
      source_url: sourceUrl,
      cover_url: coverUrl,
      images,
      image_count: images.length,
      model_name: modelName || null,
      channel_name: channelName || null,
      categories: cleanList(body?.categories),
      tags: cleanList(body?.tags),
      source_views: sourceViews,
    },
    error: null,
  };
}

export async function GET(request: Request) {
  const session = await authorize("media.upload");
  if (!session) return NextResponse.json({ error: "অননুমোদিত অ্যাক্সেস।" }, { status: 403 });

  // Server-side pagination + status filter, mirroring the video admin list.
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page") || 1) || 1);
  const statusFilter = searchParams.get("status"); // "published" | "draft" | "scheduled" | null(=all)
  const pageSize = 15;
  const offset = (page - 1) * pageSize;

  const supabase = getSupabaseAdmin();
  const baseColumns =
    "id, title, description, source_url, cover_url, images, image_count, model_name, channel_name, categories, tags, source_views, status, created_at, published_at";
  // `public_slug` and `scheduled_at` are optional (added by
  // scripts/media-slugs.sql and scripts/media-schedule.sql) — the list
  // query falls back to the pre-migration column set if PostgREST rejects
  // them.
  const slugColumns = `${baseColumns}, public_slug`;
  const scheduleColumns = `${slugColumns}, scheduled_at`;

  const applyFilter = (q: any) => {
    let out = q.neq("status", "deleted");
    if (statusFilter === "published" || statusFilter === "draft") {
      out = out.eq("status", statusFilter);
    } else if (statusFilter === "scheduled") {
      // Scheduled rows are already "published" in the DB but their
      // `published_at` lies in the future — that's what keeps them hidden
      // from the public pages.
      out = out
        .eq("status", "published")
        .not("scheduled_at", "is", null)
        .gt("scheduled_at", new Date().toISOString());
    }
    return out;
  };

  let res = await applyFilter(
    supabase
      .from("picture_galleries")
      .select(scheduleColumns, { count: "exact" }),
  )
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (res.error) {
    // `scheduled_at` and/or `public_slug` may be missing (their
    // migrations haven't been run). Retry with the columns we know exist,
    // dropping the optional ones one at a time.
    for (const columns of [slugColumns, baseColumns]) {
      if (!res.error) break;
      const fallback = await applyFilter(
        supabase
          .from("picture_galleries")
          .select(columns, { count: "exact" }),
      )
        .order("created_at", { ascending: false })
        .range(offset, offset + pageSize - 1);
      res = fallback;
    }
  }

  if (res.error) {
    console.error("[admin/pictures] list failed:", res.error);
    return NextResponse.json(
      { error: "ছবির গ্যালারি তালিকা লোড করা যায়নি।" },
      { status: 500 },
    );
  }

  // Global counts for the stat strip (independent of the active filter and
  // page) — run in parallel; each is a cheap head-count.
  const nowIso = new Date().toISOString();
  const [totalRes, publishedRes, imagesRes, scheduledRes] = await Promise.all([
    supabase
      .from("picture_galleries")
      .select("id", { count: "exact", head: true })
      .neq("status", "deleted"),
    // "Published" means live right now — a row whose publish time is still
    // in the future is scheduled, not published.
    supabase
      .from("picture_galleries")
      .select("id", { count: "exact", head: true })
      .eq("status", "published")
      .lte("published_at", nowIso)
      .neq("status", "deleted"),
    (async () => {
      const ir = await supabase
        .from("picture_galleries")
        .select("image_count")
        .neq("status", "deleted");
      if (ir.error || !Array.isArray(ir.data)) return null;
      return (ir.data as any[]).reduce(
        (sum, r) => sum + (Number(r.image_count) || 0),
        0,
      );
    })(),
    (async () => {
      // Scheduled rows live in the same "published" bucket, so the count
      // needs the future timestamp — and a missing `scheduled_at` column
      // (migration not run yet) just means "no scheduled galleries".
      const sr = await supabase
        .from("picture_galleries")
        .select("id", { count: "exact", head: true })
        .eq("status", "published")
        .not("scheduled_at", "is", null)
        .gt("scheduled_at", nowIso)
        .neq("status", "deleted");
      if (sr.error) return 0;
      return sr.count ?? 0;
    })(),
  ]);

  const total = res.count ?? 0;

  return NextResponse.json({
    pictures: res.data || [],
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    page,
    stats: {
      totalGalleries: totalRes.count ?? 0,
      publishedGalleries: publishedRes.count ?? 0,
      scheduledGalleries: scheduledRes,
      totalImages: imagesRes ?? null,
    },
  });
}

export async function POST(request: Request) {
  const session = await authorize("media.upload");
  if (!session) return NextResponse.json({ error: "অননুমোদিত অ্যাক্সেস।" }, { status: 403 });

  try {
    const body = await request.json();
    const { values, error } = parseGalleryPayload(body);
    if (error || !values) {
      return NextResponse.json({ error }, { status: 400 });
    }

    // ---- Duplicate guard -----------------------------------------------
    // The same gallery can be pasted in several shapes (trailing slash,
    // `www.`, tracking query string). `pictureSourceKey` folds those into
    // one canonical key, which is also what the unique index in
    // scripts/picture-duplicates.sql is built on.
    //
    // This pre-check exists purely so the admin gets a readable Bengali
    // message instead of a raw database error. The unique index remains
    // the real guarantee — two admins publishing at the same instant are
    // still serialised by the database.
    const sourceKey = pictureSourceKey(values.source_url);
    if (sourceKey) {
      const { data: existing } = await getSupabaseAdmin()
        .from("picture_galleries")
        .select("id, title, status")
        .eq("source_key", sourceKey)
        .neq("status", "deleted")
        .maybeSingle();

      if (existing) {
        return NextResponse.json(
          {
            error: `এই গ্যালারিটি ইতিমধ্যে আছে ("${existing.title}")। একই গ্যালারি দুইবার পাবলিশ করা যাবে না।`,
            duplicate: true,
            existingId: existing.id,
            existingTitle: existing.title,
          },
          { status: 409 },
        );
      }
    }
    // --------------------------------------------------------------------

    // Schedule handling — an empty field publishes immediately, a future
    // timestamp parks the row until the cron route picks it up.
    const publishState = resolvePublishState({ scheduledAt: body.scheduledAt });

    // The id is generated here rather than by the database, so the public
    // slug can be minted in the same insert. A gallery that is scheduled
    // for later already has its slug when it is saved — the cron route
    // that publishes it doesn't need to do anything extra.
    const galleryId = randomUUID();
    const publicSlug = await mintPublicSlug("picture", values.title);

    const { data, error: insertError } = await getSupabaseAdmin()
      .from("picture_galleries")
      .insert({
        ...values,
        id: galleryId,
        public_slug: publicSlug,
        status: publishState.status,
        created_by: session.id,
        published_at: publishState.published_at,
        scheduled_at: publishState.scheduled_at,
      })
      .select(
        "id, title, public_slug, description, source_url, cover_url, images, image_count, model_name, channel_name, categories, tags, source_views, status, created_at, published_at, scheduled_at",
      )
      .single();

    // The unique index is the real guard. If two requests raced past the
    // pre-check above, the database refuses the second one — and we turn
    // that refusal into the same friendly message.
    if (insertError) {
      if (isUniqueViolation(insertError)) {
        return NextResponse.json(
          {
            error: "এই গ্যালারিটি ইতিমধ্যে পাবলিশ করা আছে। একই গ্যালারি দুইবার পাবলিশ করা যাবে না।",
            duplicate: true,
          },
          { status: 409 },
        );
      }
      throw insertError;
    }

    // Announce the new gallery in the global chat. Never blocks the
    // response — `announcePicturePublished` swallows its own failures.
    //
    // A scheduled gallery is NOT announced here — the announcement belongs
    // to the moment it actually goes live, which is the cron route's job.
    if (!publishState.scheduled_at) {
      await announcePicturePublished(data.id, values.title);
    }

    invalidateTags(CACHE_TAGS.pictures);

    return NextResponse.json({
      picture: data,
      scheduled: !!publishState.scheduled_at,
      scheduledAt: publishState.scheduled_at,
    });
  } catch (error) {
    console.error("[admin/pictures] create failed:", error);
    return NextResponse.json(
      { error: "গ্যালারি সংরক্ষণ করা যায়নি।" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const session = await authorize("media.upload");
  if (!session) return NextResponse.json({ error: "অননুমোদিত অ্যাক্সেস।" }, { status: 403 });

  try {
    const body = await request.json();
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "গ্যালারি আইডি পাওয়া যায়নি।" }, { status: 400 });
    }

    // Two kinds of patch:
    //   1) Status-only toggle — { id, status }
    //   2) Full edit           — { id, title, description, sourceUrl, …, scheduledAt }
    const editFields = [
      "title",
      "description",
      "sourceUrl",
      "coverUrl",
      "images",
      "modelName",
      "channelName",
      "categories",
      "tags",
    ];
    const isFullEdit =
      editFields.some((k) => body[k] !== undefined) ||
      body.scheduledAt !== undefined;

    // Read the CURRENT status before mutating. The chat announcement must
    // fire only on a real draft→published transition: re-announcing every
    // time an admin fixes a typo in a live gallery's title would spam the
    // global room.
    const desiredStatusHint =
      body.status === "draft" || body.status === "published" ? body.status : null;
    let wasPublished = false;
    if (desiredStatusHint === "published") {
      const { data: current } = await getSupabaseAdmin()
        .from("picture_galleries")
        .select("status")
        .eq("id", id)
        .neq("status", "deleted")
        .maybeSingle();
      wasPublished = current?.status === "published";
    }

    if (isFullEdit) {
      const { values, error } = parseGalleryPayload(body);
      if (error || !values) {
        return NextResponse.json({ error }, { status: 400 });
      }

      const desiredStatus =
        body.status === "draft" || body.status === "published"
          ? body.status
          : undefined;

      const update: Record<string, any> = {
        ...values,
        updated_at: new Date().toISOString(),
      };

      // Schedule is tri-state:
      //   ISO string → set / reschedule
      //   null       → clear the schedule (publish now)
      //   undefined  → leave the existing schedule untouched
      const schedulePatch = resolveSchedulePatch(
        body.scheduledAt === undefined ? undefined : body.scheduledAt,
      );
      Object.assign(update, schedulePatch);

      if (desiredStatus) {
        update.status = desiredStatus;
        // A draft drops the schedule entirely; publishing now clears it too
        // unless a future schedule was just requested.
        if (desiredStatus === "draft") {
          update.published_at = null;
          update.scheduled_at = null;
        } else if (!schedulePatch.scheduled_at) {
          update.published_at =
            schedulePatch.published_at ?? new Date().toISOString();
          if (!schedulePatch.scheduled_at) update.scheduled_at = null;
        }
      }

      // Duplicate guard on edit too: pointing gallery A's URL at gallery B's
      // URL would create the same duplicate the insert guard prevents.
      // The row being edited is excluded from the check.
      const sourceKey = pictureSourceKey(values.source_url);
      if (sourceKey) {
        const { data: existing } = await getSupabaseAdmin()
          .from("picture_galleries")
          .select("id, title")
          .eq("source_key", sourceKey)
          .neq("id", id)
          .neq("status", "deleted")
          .maybeSingle();

        if (existing) {
          return NextResponse.json(
            {
              error: `এই গ্যালারিটি ইতিমধ্যে আছে ("${existing.title}")। একই গ্যালারি দুইবার পাবলিশ করা যাবে না।`,
              duplicate: true,
              existingId: existing.id,
              existingTitle: existing.title,
            },
            { status: 409 },
          );
        }
      }

      const { error: updateError } = await getSupabaseAdmin()
        .from("picture_galleries")
        .update(update)
        .eq("id", id)
        .neq("status", "deleted");

      if (updateError) {
        if (isUniqueViolation(updateError)) {
          return NextResponse.json(
            {
              error: "এই গ্যালারিটি ইতিমধ্যে পাবলিশ করা আছে। একই গ্যালারি দুইবার পাবলিশ করা যাবে না।",
              duplicate: true,
            },
            { status: 409 },
          );
        }
        throw updateError;
      }

      // Announce only when this PATCH was the thing that flipped the row
      // from draft → published; a metadata-only edit of an already-live
      // gallery is not news.
      //
      // A row that ends up scheduled for a future moment is not announced
      // either — the cron route announces it when it actually goes live.
      const endsScheduled = !!update.scheduled_at;
      if (
        desiredStatus === "published" &&
        !wasPublished &&
        update.title &&
        !endsScheduled
      ) {
        await announcePicturePublished(id, String(update.title));
      }

      return NextResponse.json({
        success: true,
        scheduled: endsScheduled,
        scheduledAt: update.scheduled_at ?? null,
      });
    }

    // Status-only toggle.
    const { status } = body;
    if (!["draft", "published"].includes(status)) {
      return NextResponse.json({ error: "গ্যালারির তথ্য সঠিক নয়।" }, { status: 400 });
    }

    // Capture the title before mutating so the chat announcement, if we
    // send one, can include the correct headline.
    let titleForAnnounce: string | null = null;
    if (status === "published") {
      const { data: existing } = await getSupabaseAdmin()
        .from("picture_galleries")
        .select("id, title, status")
        .eq("id", id)
        .neq("status", "deleted")
        .maybeSingle();

      // Only announce on draft → published. Re-publishing an already-live
      // row, or un-publishing to draft, is not a publish event.
      if (existing && existing.status !== "published") {
        titleForAnnounce = existing.title;
      }
    }

    const { error: updateError } = await getSupabaseAdmin()
      .from("picture_galleries")
      .update({
        status,
        published_at: status === "published" ? new Date().toISOString() : null,
        // Toggling to "published" means "I want this live now" — any
        // pending schedule is dropped. Toggling to "draft" cancels it too.
        scheduled_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .neq("status", "deleted");
    if (updateError) throw updateError;

    if (titleForAnnounce) {
      await announcePicturePublished(id, titleForAnnounce);
    }

    invalidateTags(CACHE_TAGS.pictures);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/pictures] update failed:", error);
    return NextResponse.json(
      { error: "গ্যালারির তথ্য পরিবর্তন করা যায়নি।" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const session = await authorize("media.delete");
  if (!session) return NextResponse.json({ error: "অননুমোদিত অ্যাক্সেস।" }, { status: 403 });

  try {
    const { id } = await request.json();
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "গ্যালারি আইডি পাওয়া যায়নি।" }, { status: 400 });
    }

    // Soft delete — the row (and its image links) stay in the DB so the
    // gallery can be restored later.
    const { error } = await getSupabaseAdmin()
      .from("picture_galleries")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("id", id)
      .neq("status", "deleted");
    if (error) throw error;
    invalidateTags(CACHE_TAGS.pictures);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/pictures] delete failed:", error);
    return NextResponse.json(
      { error: "গ্যালারি ডিলিট করা যায়নি।" },
      { status: 500 },
    );
  }
}
