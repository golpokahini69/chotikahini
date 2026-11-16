import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import readingTime from "reading-time";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getSession } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { clearPostsCache } from "@/lib/posts";
import { getDhakaTimeISO } from "@/lib/story-formatter";
import { canDeletePermanently, canHideContent, hasPermission } from "@/lib/permissions";
import { logAudit, logAuditCritical } from "@/lib/audit";
import { notifyAdmins, notifyUser } from "@/lib/notify";
import { assignPublicSlug } from "@/lib/public-slug-assign";
import { announceStoryPublished } from "@/lib/chat-system";

// Invalidates cached ISR pages immediately after a story lifecycle change.
function revalidateStoryPaths(
  slug?: string | null,
  uid?: string | null,
  publicSlug?: string | null,
) {
  revalidatePath("/");
  if (slug) revalidatePath(`/${slug}`);
  if (uid && uid !== slug) revalidatePath(`/${uid}`);
  // The new public route. Without this a published story's `/golpo/<slug>`
  // page would keep serving the "not found" state until the route's own
  // revalidate window elapsed.
  if (publicSlug) revalidatePath(`/golpo/${publicSlug}`);
  // The feeds and the sitemap are derived from the same stories. Without
  // this a newly published story only appeared in the feed after the route's
  // own revalidate window (an hour), so readers saw the new story late.
  revalidatePath("/rss.xml");
  revalidatePath("/rss-pictures.xml");
  revalidatePath("/sitemap.xml");
}

// Helper to send a notification to a single user.
//
// This goes through `notifyUser` rather than a raw insert because:
//   - the notifications PK (`id`) is NOT NULL, and omitting it fails the insert
//   - supabase-js RESOLVES on failure instead of rejecting, so a bare
//     try/catch never sees the error — the previous version silently lost
//     every story-approval notification
//   - `notifyUser` sets the id, inspects the resolved error and reports the
//     outcome to the caller
async function sendNotif(userId: string, type: string, postSlug: string, snippet: string, postId?: string | null) {
  const supabase = getSupabaseAdmin();
  const ok = await notifyUser(
    userId,
    {
      type,
      actorName: "অ্যাডমিন",
      snippet: snippet.length > 200 ? snippet.substring(0, 200) + "..." : snippet,
      postSlug,
      postId: postId || null,
    },
    supabase
  );
  if (!ok) {
    console.error("[sendNotif] failed to insert notification for user", userId, "type", type);
  }
  return ok;
}

// Upsert post_metadata in Supabase after a publish action
async function upsertPostMetadata(
  uid: string, slug: string, authorUsername: string,
  status: string, category: string, publishedAt: string
) {
  try {
    const supabase = getSupabaseAdmin();
    let authorId: string | null = null;
    if (authorUsername && authorUsername !== "admin") {
      const { data: u } = await supabase.from("users").select("id").eq("username", authorUsername).maybeSingle();
      authorId = u?.id || null;
      if (!authorId) {
        const { data: u2 } = await supabase.from("users").select("id").eq("id", authorUsername).maybeSingle();
        authorId = u2?.id || null;
      }
    }
    if (!authorId) {
      const { data: adminUser } = await supabase.from("users").select("id").eq("role", "admin").limit(1).maybeSingle();
      authorId = adminUser?.id || null;
    }
    await supabase.from("post_metadata").upsert(
      { mdx_uid: String(uid), slug, author_id: authorId, status, category: category || null, published_at: publishedAt, updated_at: new Date().toISOString() },
      { onConflict: "mdx_uid" }
    );
  } catch (e) {
    console.error("Failed to upsert post_metadata:", e);
  }
}

// Posts an automated announcement to the Global Community Chat when a new
// story is published.
//
// Routed through `announceStoryPublished` so the message is a real system
// row (the blue "সিস্টেম" pill) with an absolute link, matching the video
// and gallery announcements. The helper swallows its own failures — a chat
// blip must never fail the publish.
async function sendGlobalChatAnnouncement(postSlug: string, postTitle: string, postUid?: string) {
  const targetPath = postUid || postSlug;
  await announceStoryPublished(targetPath, postTitle);
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    const isAuth = await isAdminAuthenticated();
    if (!isAuth || !session) {
      return NextResponse.json({ error: "অননুমোদিত অ্যাক্সেস।" }, { status: 401 });
    }
    const role = session.role || "user";

    const {
      action, uid, fileSlug, feedback, reason,
      editedTitle, editedContent, editedDescription,
      editedCategory, editedTags, editedAuthor, editedCover, editedPreviousPost, editedFeatured,
      bulkAction, uids
    } = await req.json();

    const supabase = getSupabaseAdmin();

    if (action === "bulk") {
      if (!Array.isArray(uids) || uids.length === 0) {
        return NextResponse.json({ error: "কোনো গল্প নির্বাচন করা হয়নি।" }, { status: 400 });
      }
      if (bulkAction === "publish") {
        if (!hasPermission(role, "content.publish")) {
          return NextResponse.json({ error: "আপনার এই অ্যাকশনের অনুমতি নেই।" }, { status: 403 });
        }

        // Publishing has to be per-story, not a single bulk UPDATE: each
        // story needs its own public slug, its own metadata row, and its
        // own cache invalidation. A one-line UPDATE would publish the
        // stories but leave them without a slug.
        const { data: toPublish, error: bulkError } = await supabase
          .from("stories")
          .select("uid, title, slug, author_id, category, published_at, public_slug")
          .in("uid", uids);
        if (bulkError) throw bulkError;

        for (const story of toPublish || []) {
          const publicSlug =
            story.public_slug ||
            (await assignPublicSlug("story", "stories", "uid", story.uid, story.title));

          const { error: pubErr } = await supabase
            .from("stories")
            .update({
              status: "published",
              published_at: story.published_at || getDhakaTimeISO(),
              public_slug: publicSlug,
              updated_at: new Date().toISOString(),
            })
            .eq("uid", story.uid);
          if (pubErr) throw pubErr;

          await upsertPostMetadata(
            story.uid,
            story.slug,
            story.author_id,
            "published",
            story.category,
            story.published_at || getDhakaTimeISO(),
          );
          revalidateStoryPaths(story.slug, story.uid, publicSlug);
          await sendGlobalChatAnnouncement(story.slug, story.title, story.uid);
        }
      } else if (bulkAction === "delete") {
        if (canDeletePermanently(role)) {
          const { error: bulkError } = await supabase.from("stories").delete().in("uid", uids);
          if (bulkError) throw bulkError;
        } else if (canHideContent(role)) {
          // Limited admins: hide + request permanent deletion from superadmin
          const { error: bulkError } = await supabase.from("stories").update({ status: "hidden", updated_at: new Date().toISOString() }).in("uid", uids);
          if (bulkError) throw bulkError;
          const { data: stories } = await supabase.from("stories").select("uid").in("uid", uids);
          for (const s of stories || []) {
            const { error: reqError } = await supabase.from("deletion_requests").insert({
              target_type: "story",
              target_id: s.uid,
              requested_by: session.id,
              reason: "বাল্ক ডিলিট অনুরোধ",
              status: "pending",
            });
            if (reqError) throw reqError;
          }
          await notifyAdmins(
            {
              type: "deletion_request",
              actorId: session.id,
              snippet: `অ্যাডমিন @${session.username} ${uids.length}টি গল্প স্থায়ী ডিলিটের অনুরোধ করেছেন।`,
            },
            supabase
          );
        } else {
          return NextResponse.json({ error: "আপনার গল্প ডিলিট করার অনুমতি নেই।" }, { status: 403 });
        }
      } else if (bulkAction === "archive") {
        if (!hasPermission(role, "content.reject")) {
          return NextResponse.json({ error: "আপনার এই অ্যাকশনের অনুমতি নেই।" }, { status: 403 });
        }
        const { error: bulkError } = await supabase.from("stories").update({ status: "rejected", updated_at: new Date().toISOString() }).in("uid", uids);
        if (bulkError) throw bulkError;
      }
      clearPostsCache();
      revalidatePath("/");
      return NextResponse.json({ success: true, count: uids.length, message: `${uids.length}টি গল্পের ওপর ${bulkAction} অ্যাকশন সফল হয়েছে!` });
    }

    const ref = String(uid || fileSlug || "").replace(/\.mdx$/i, "");
    if (!ref) {
      return NextResponse.json({ error: "Story reference is required" }, { status: 400 });
    }

    const cleanSlug = ref.replace(/\.mdx$/i, "");

    // Fetch the story from Supabase stories table
    const { data: dbStory } = await supabase
      .from("stories")
      .select("*")
      .or(`slug.eq.${cleanSlug},uid.eq.${cleanSlug}`)
      .maybeSingle();

    if (!dbStory) {
      return NextResponse.json({ error: "ডাটাবেজে গল্পটি পাওয়া যায়নি।" }, { status: 404 });
    }

    const nowIso = getDhakaTimeISO();
    let history = Array.isArray(dbStory.history) ? [...dbStory.history] : [];

    if (action === "approve_publish") {
      if (!hasPermission(role, "content.publish")) {
        return NextResponse.json({ error: "আপনার গল্প প্রকাশের অনুমতি নেই।" }, { status: 403 });
      }
      history.push({ event: "published", at: nowIso, actor: "admin" });

      // Mint the public slug the moment the story goes live. A story that
      // already has one keeps it — the slug is fixed at publish time, so a
      // link that was already shared never breaks when the title is edited.
      const publicSlug =
        dbStory.public_slug ||
        (await assignPublicSlug("story", "stories", "uid", dbStory.uid, dbStory.title));

      const { error: publishError } = await supabase.from("stories").update({
        status: "published",
        published_at: dbStory.published_at || nowIso,
        public_slug: publicSlug,
        history,
        updated_at: new Date().toISOString()
      }).eq("id", dbStory.id);
      if (publishError) throw publishError;

      await upsertPostMetadata(dbStory.uid, dbStory.slug, dbStory.author_id, "published", dbStory.category, dbStory.published_at || nowIso);
      await autoCleanAuthorPendingDuplicates(supabase, dbStory.author_id, dbStory.id, dbStory.title);
      await sendNotif(dbStory.author_id, "story_approved", dbStory.slug, `আপনার গল্প "${dbStory.title}" অনুমোদিত ও প্রকাশিত হয়েছে!`);
      await sendGlobalChatAnnouncement(dbStory.slug, dbStory.title, dbStory.uid);
      revalidateStoryPaths(dbStory.slug, dbStory.uid, publicSlug);
      clearPostsCache();
      logAudit(session, { action: "story.approve", targetType: "story", targetId: dbStory.uid, prevState: { status: dbStory.status }, newState: { status: "published" } });

      return NextResponse.json({ success: true, message: `"${dbStory.title}" গল্পটি সফলভাবে প্রকাশিত হয়েছে!` });
    }

    if (action === "edit_publish") {
      if (!hasPermission(role, "content.publish") && !hasPermission(role, "content.edit")) {
        return NextResponse.json({ error: "আপনার গল্প এডিট করে প্রকাশের অনুমতি নেই।" }, { status: 403 });
      }

      const newTitle = (editedTitle !== undefined ? String(editedTitle) : (dbStory.title || "")).trim();
      const newContent = (editedContent !== undefined ? String(editedContent) : (dbStory.content || "")).trim();
      const newDescription = editedDescription !== undefined ? String(editedDescription).trim() : (dbStory.description || "");
      const newCategory = editedCategory !== undefined ? String(editedCategory).trim() : (dbStory.category || "golpo");
      let newCover = editedCover !== undefined ? String(editedCover).trim() : (dbStory.cover || "");
      if (newCover.startsWith("data:image") || newCover.length > 500) {
        newCover = "";
      }
      if (newCover) {
        const { normalizeCoverUrl } = await import("@/lib/cover");
        newCover = normalizeCoverUrl(newCover);
      }
      if (!newCover) {
        const { getUnusedCover } = await import("@/lib/cover");
        newCover = (await getUnusedCover(supabase)) || "";
      }
      const newPreviousPost = editedPreviousPost !== undefined ? String(editedPreviousPost).trim() : (dbStory.previous_post || "");
      const newReadingTime = readingTime(newContent || "").text;

      let newTags = dbStory.tags;
      if (editedTags !== undefined) {
        newTags = Array.isArray(editedTags)
          ? editedTags
          : String(editedTags).split(",").map((t) => t.trim()).filter(Boolean);
      }

      let effectiveAuthorId = dbStory.author_id;
      if (editedAuthor && editedAuthor !== dbStory.author_id) {
        const { data: uById } = await supabase.from("users").select("id").eq("id", editedAuthor).maybeSingle();
        if (uById) {
          effectiveAuthorId = uById.id;
        } else {
          const { data: uByUsername } = await supabase.from("users").select("id").eq("username", editedAuthor).maybeSingle();
          effectiveAuthorId = uByUsername?.id || dbStory.author_id;
        }
      }

      history.push({ event: "published", at: nowIso, actor: session.username || session.id, note: "admin full edit & publish" });

      // Mint the public slug the moment the story goes live. A story that
      // already has one keeps it — the slug is fixed at publish time, so a
      // link that was already shared never breaks when the title is edited.
      const publicSlug =
        dbStory.public_slug ||
        (await assignPublicSlug("story", "stories", "uid", dbStory.uid, newTitle));

      const { error: editPublishError } = await supabase.from("stories").update({
        title: newTitle,
        content: newContent,
        description: newDescription,
        category: newCategory,
        tags: newTags,
        author_id: effectiveAuthorId,
        cover: newCover,
        previous_post: newPreviousPost,
        reading_time: newReadingTime,
        featured: editedFeatured !== undefined ? Boolean(editedFeatured) : (dbStory.featured || false),
        status: "published",
        published_at: dbStory.published_at || nowIso,
        public_slug: publicSlug,
        history,
        updated_at: new Date().toISOString()
      }).eq("id", dbStory.id);
      if (editPublishError) throw editPublishError;

      await upsertPostMetadata(dbStory.uid, dbStory.slug, effectiveAuthorId, "published", newCategory, dbStory.published_at || nowIso);
      await autoCleanAuthorPendingDuplicates(supabase, effectiveAuthorId, dbStory.id, newTitle);
      await sendNotif(effectiveAuthorId, "story_approved", dbStory.slug, `অ্যাডমিন আপনার গল্প "${newTitle}" সম্পাদন করে প্রকাশ করেছেন!`, dbStory.id);
      await sendGlobalChatAnnouncement(dbStory.slug, newTitle, dbStory.uid);
      revalidateStoryPaths(dbStory.slug, dbStory.uid, publicSlug);
      clearPostsCache();

      return NextResponse.json({ success: true, message: `"${newTitle}" গল্পটির সব তথ্য এডিট করে সফলভাবে প্রকাশিত হয়েছে!` });
    }

    if (action === "request_revision") {
      if (!hasPermission(role, "content.reject")) {
        return NextResponse.json({ error: "আপনার এই অ্যাকশনের অনুমতি নেই।" }, { status: 403 });
      }
      const feedbackText = (feedback || reason || "সংশোধন প্রয়োজন").trim();
      history.push({ event: "revision_requested", at: nowIso, feedback: feedbackText, actor: "admin" });
      const { error: revisionError } = await supabase.from("stories").update({
        status: "revision_requested",
        rejection_reason: feedbackText,
        history,
        updated_at: new Date().toISOString()
      }).eq("id", dbStory.id);
      if (revisionError) throw revisionError;

      await sendNotif(dbStory.author_id, "story_revision_requested", dbStory.slug, `আপনার গল্প "${dbStory.title}" এ সংশোধন প্রস্তাব করা হয়েছে: ${feedbackText}`);
      logAudit(session, { action: "story.request_revision", targetType: "story", targetId: dbStory.uid, newState: { feedback: feedbackText } });
      clearPostsCache();

      return NextResponse.json({ success: true, message: "লেখককে সংশোধন প্রস্তাব পাঠানো হয়েছে।" });
    }

    if (action === "reject") {
      if (!hasPermission(role, "content.reject")) {
        return NextResponse.json({ error: "আপনার এই অ্যাকশনের অনুমতি নেই।" }, { status: 403 });
      }
      const rejectionText = (reason || feedback || "প্রত্যাখ্যাত").trim();
      history.push({ event: "rejected", at: nowIso, feedback: rejectionText, actor: "admin" });
      const { error: rejectError } = await supabase.from("stories").update({
        status: "rejected",
        rejection_reason: rejectionText,
        history,
        updated_at: new Date().toISOString()
      }).eq("id", dbStory.id);
      if (rejectError) throw rejectError;

      await sendNotif(dbStory.author_id, "story_rejected", dbStory.slug, `আপনার গল্প "${dbStory.title}" প্রত্যাখ্যান করা হয়েছে। কারণ: ${rejectionText}`);
      logAudit(session, { action: "story.reject", targetType: "story", targetId: dbStory.uid, newState: { reason: rejectionText } });
      clearPostsCache();

      return NextResponse.json({ success: true, message: "গল্পটি প্রত্যাখ্যান করা হয়েছে।" });
    }

    if (action === "unpublish") {
      if (!hasPermission(role, "content.reject")) {
        return NextResponse.json({ error: "আপনার এই অ্যাকশনের অনুমতি নেই।" }, { status: 403 });
      }
      history.push({ event: "created", at: nowIso, actor: "admin" });
      const { error: unpublishError } = await supabase.from("stories").update({
        status: "draft",
        history,
        updated_at: new Date().toISOString()
      }).eq("id", dbStory.id);
      if (unpublishError) throw unpublishError;

      await sendNotif(dbStory.author_id, "story_unpublished", dbStory.slug, `আপনার গল্প "${dbStory.title}" ড্রাফটে স্থানান্তর করা হয়েছে।`);
      revalidateStoryPaths(dbStory.slug, dbStory.uid);
      logAudit(session, { action: "story.unpublish", targetType: "story", targetId: dbStory.uid });
      clearPostsCache();

      return NextResponse.json({ success: true, message: "গল্পটি ড্রাফটে স্থানান্তর করা হয়েছে।" });
    }

if (action === "delete") {
      if (canDeletePermanently(role)) {
        const auditOk = await logAuditCritical(session, { action: "content.delete_permanent", targetType: "story", targetId: dbStory.uid, prevState: { status: dbStory.status, title: dbStory.title } });
        if (!auditOk) {
          return NextResponse.json({ error: "অডিট লগ ব্যর্থ হয়েছে। স্থায়ী ডিলিট বাতিল করা হলো।" }, { status: 500 });
        }
        await sendNotif(dbStory.author_id, "story_deleted", dbStory.slug, `আপনার গল্প "${dbStory.title}" মুছে ফেলা হয়েছে।`);
        const { error: storyDeleteError } = await supabase.from("stories").delete().eq("id", dbStory.id);
        if (storyDeleteError) throw storyDeleteError;
        const { error: metaDeleteError } = await supabase.from("post_metadata").delete().eq("slug", dbStory.slug);
        if (metaDeleteError) throw metaDeleteError;
        revalidateStoryPaths(dbStory.slug, dbStory.uid);
        clearPostsCache();
        return NextResponse.json({ success: true, message: "গল্পটি সফলভাবে স্থায়ীভাবে মুছে ফেলা হয়েছে।" });
      } else if (canHideContent(role)) {
        // Hide the story and create a deletion request for superadmin
        history.push({ event: "hidden", at: nowIso, actor: "admin", note: "limited admin hide" });
        const { error: hideError } = await supabase.from("stories").update({ status: "hidden", history, updated_at: new Date().toISOString() }).eq("id", dbStory.id);
        if (hideError) throw hideError;
        const { error: hideReqError } = await supabase.from("deletion_requests").insert({
          target_type: "story",
          target_id: dbStory.uid || dbStory.slug,
          requested_by: session.id,
          reason: reason || "স্থায়ী ডিলিটের অনুরোধ",
          status: "pending",
        });
        if (hideReqError) throw hideReqError;
        await sendNotif(dbStory.author_id, "story_hidden", dbStory.slug, `আপনার গল্প "${dbStory.title}" অ্যাডমিন কর্তৃক লুকানো হয়েছে।`);
        await notifyAdmins(
          {
            type: "deletion_request",
            actorId: session.id,
            snippet: `অ্যাডমিন @${session.username} "${dbStory.title}" গল্পটির স্থায়ী ডিলিটের অনুরোধ করেছেন।`,
          },
          supabase
        );
        revalidateStoryPaths(dbStory.slug, dbStory.uid);
        clearPostsCache();
        return NextResponse.json({ success: true, message: "গল্পটি লুকানো হয়েছে। স্থায়ী ডিলিটের জন্য সুপার অ্যাডমিনের অনুমোদন প্রয়োজন।" });
      } else {
        return NextResponse.json({ error: "আপনার গল্প ডিলিট করার অনুমতি নেই।" }, { status: 403 });
      }
    }

    return NextResponse.json({ error: "অবৈধ অ্যাকশন।" }, { status: 400 });
  } catch (error: any) {
    console.error("Manage post error:", error);
    return NextResponse.json({ error: error.message || "অপারেশন ব্যর্থ হয়েছে।" }, { status: 500 });
  }
}

async function autoCleanAuthorPendingDuplicates(supabase: any, authorId: string, targetStoryId: any, targetTitle: string) {
  try {
    if (!authorId || !targetTitle) return;
    const { data: pendings } = await supabase
      .from("stories")
      .select("id, uid, title, content")
      .eq("author_id", authorId)
      .eq("status", "pending")
      .neq("id", targetStoryId);

    if (Array.isArray(pendings) && pendings.length > 0) {
      for (const p of pendings) {
        const isSameTitle = p.title && p.title.trim().toLowerCase() === targetTitle.trim().toLowerCase();
        if (isSameTitle) {
          await supabase
            .from("stories")
            .update({
              status: "rejected",
              rejection_reason: "পরবর্তী/সংশোধিত সংস্করণটি প্রকাশিত হওয়ায় এই অপেক্ষমাণ সংস্করণটি স্বয়ংক্রিয়ভাবে বন্ধ করা হয়েছে।",
              updated_at: new Date().toISOString()
            })
            .eq("id", p.id);
        }
      }
    }
  } catch (e) {
    console.error("autoCleanAuthorPendingDuplicates error:", e);
  }
}
