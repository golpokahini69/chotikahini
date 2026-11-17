"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  Images,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import { enToBnNumber, formatDateTime } from "@/lib/utils";
import {
  PictureFormFields,
  type PictureFormValues,
  type PictureImageValue,
} from "./PictureFormFields";
import { AdminPagination } from "./AdminPagination";
import { CountdownTimer } from "@/components/CountdownTimer";

interface PictureGallery {
  id: string;
  /**
   * The readable public slug — e.g. "kutir-chobi". Null for galleries
   * published before public slugs existed.
   */
  public_slug?: string | null;
  title: string;
  description: string | null;
  source_url: string;
  cover_url: string;
  images: PictureImageValue[];
  image_count: number;
  model_name: string | null;
  channel_name: string | null;
  categories: string[] | null;
  tags: string[] | null;
  source_views: number | null;
  status: "draft" | "published";
  created_at: string;
  published_at: string | null;
  /** Future publish time — present once scripts/media-schedule.sql has run. */
  scheduled_at?: string | null;
}

/** Server-paged list metadata returned alongside the rows. */
interface ListMeta {
  total: number;
  totalPages: number;
  page: number;
  stats: {
    totalGalleries: number;
    publishedGalleries: number;
    /** Galleries waiting for their scheduled publish time. */
    scheduledGalleries: number;
    /** null when the image_count column is missing. */
    totalImages: number | null;
  };
}

const EMPTY_FORM: PictureFormValues = {
  sourceUrl: "",
  title: "",
  description: "",
  coverUrl: "",
  images: [],
  modelName: "",
  channelName: "",
  categories: [],
  tags: [],
  sourceViews: null,
  scheduledAt: "",
};

export type PictureManagerView = "all" | "publish" | "list";

export function PictureManager({ view = "all" }: { view?: PictureManagerView }) {
  const [pictures, setPictures] = useState<PictureGallery[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<PictureFormValues>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "published" | "draft" | "scheduled"
  >("all");
  // When set, the create form becomes an edit form for this gallery id.
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadPictures = useCallback(
    async (opts?: { page?: number; status?: string }) => {
      const targetPage = opts?.page ?? page;
      const targetStatus = opts?.status ?? (statusFilter === "all" ? "" : statusFilter);
      setLoading(true);
      setError("");
      try {
        const qs = new URLSearchParams();
        qs.set("page", String(targetPage));
        if (targetStatus) qs.set("status", targetStatus);
        const response = await fetch(`/api/admin/pictures?${qs.toString()}`, {
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "ছবির গ্যালারি তালিকা লোড করা যায়নি।");
        }
        setPictures(data.pictures || []);
        setMeta({
          total: data.total ?? (data.pictures || []).length,
          totalPages: data.totalPages ?? 1,
          page: data.page ?? targetPage,
          stats: data.stats || {
            totalGalleries: (data.pictures || []).length,
            publishedGalleries: (data.pictures || []).filter(
              (p: PictureGallery) => p.status === "published",
            ).length,
            scheduledGalleries: 0,
            totalImages: null,
          },
        });
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "ছবির গ্যালারি তালিকা লোড করা যায়নি।",
        );
      } finally {
        setLoading(false);
      }
    },
    [page, statusFilter],
  );

  // Initial load + whenever page/status filter changes.
  useEffect(() => {
    void loadPictures({ page, status: statusFilter === "all" ? "" : statusFilter });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter]);

  const totalCount = meta?.stats.totalGalleries ?? pictures.length;
  const publishedCount = meta?.stats.publishedGalleries ?? 0;
  const scheduledCount = meta?.stats.scheduledGalleries ?? 0;
  // Draft count isn't in stats; derive it from the totals we have.
  // Scheduled rows sit in the "published" bucket in the DB, so they are
  // subtracted here to keep the chip counts truthful.
  const draftCount = Math.max(0, totalCount - publishedCount - scheduledCount);
  const totalImages = meta?.stats.totalImages ?? null;

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setError("");
    setNotice("");
  };

  const startEdit = (picture: PictureGallery) => {
    setEditingId(picture.id);
    setForm({
      sourceUrl: picture.source_url || "",
      title: picture.title || "",
      description: picture.description || "",
      coverUrl: picture.cover_url || "",
      images: Array.isArray(picture.images) ? picture.images : [],
      modelName: picture.model_name || "",
      channelName: picture.channel_name || "",
      categories: picture.categories || [],
      tags: picture.tags || [],
      sourceViews: picture.source_views ?? null,
      // The `datetime-local` input works in local time, so the stored UTC
      // timestamp is converted back before it goes into the field.
      scheduledAt: picture.scheduled_at
        ? new Date(picture.scheduled_at).toISOString().slice(0, 16)
        : "",
    });
    setError("");
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    // The click-to-pick cover grid replaces the old always-visible required
    // input, so the same rule is enforced here: every gallery needs a cover.
    if (!form.coverUrl.trim()) {
      setError("কভার ছবি বাছুন — গ্যালারির যেকোনো ছবিতে ক্লিক করুন অথবা আলাদা URL দিন।");
      return;
    }
    const isEdit = !!editingId;
    setBusy(isEdit ? `edit:${editingId}` : "create");
    setError("");
    setNotice("");
    try {
      // The `datetime-local` field holds local time; the API expects ISO.
      const scheduledAt = form.scheduledAt
        ? new Date(form.scheduledAt).toISOString()
        : isEdit
          ? null
          : undefined;

      const response = await fetch("/api/admin/pictures", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEdit
            ? { id: editingId, ...form, scheduledAt }
            : {
                sourceUrl: form.sourceUrl.trim(),
                title: form.title.trim(),
                description: form.description.trim(),
                coverUrl: form.coverUrl.trim(),
                images: form.images,
                modelName: form.modelName.trim(),
                channelName: form.channelName.trim(),
                categories: form.categories,
                tags: form.tags,
                sourceViews: form.sourceViews,
                scheduledAt: scheduledAt ?? "",
              },
        ),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "গ্যালারি সংরক্ষণ করা যায়নি।");
      }

      const scheduledAtLabel = data.scheduledAt
        ? formatDateTime(data.scheduledAt)
        : "";

      setNotice(
        data.scheduled
          ? `গ্যালারি শিডিউল করা হয়েছে — ${scheduledAtLabel} এ প্রকাশ হবে।`
          : isEdit
            ? "গ্যালারির তথ্য হালনাগাদ হয়েছে।"
            : "গ্যালেরি প্রকাশ হয়েছে — ছবিগুলো provider-এর CDN থেকে দেখা যাবে।",
      );
      setForm(EMPTY_FORM);
      setEditingId(null);
      await loadPictures({ page, status: statusFilter === "all" ? "" : statusFilter });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "গ্যালারি সংরক্ষণ করা যায়নি।",
      );
    } finally {
      setBusy("");
    }
  };

  const updateStatus = async (picture: PictureGallery) => {
    setBusy(picture.id);
    setError("");
    try {
      const status = picture.status === "published" ? "draft" : "published";
      const response = await fetch("/api/admin/pictures", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: picture.id, status }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "গ্যালারির অবস্থা বদলানো যায়নি।");
      }
      await loadPictures({ page, status: statusFilter === "all" ? "" : statusFilter });
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "গ্যালারির অবস্থা বদলানো যায়নি।",
      );
    } finally {
      setBusy("");
    }
  };

  const deletePicture = async (picture: PictureGallery) => {
    if (!window.confirm(`“${picture.title}” গ্যালারিটি ডিলিট করবেন?`)) return;
    setBusy(picture.id);
    setError("");
    try {
      const response = await fetch("/api/admin/pictures", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: picture.id }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "গ্যালারি ডিলিট করা যায়নি।");
      }
      // Deleting the only row on the last page would leave the admin staring
      // at an empty page — step back one page instead.
      const nextPage = pictures.length === 1 && page > 1 ? page - 1 : page;
      if (nextPage !== page) {
        setPage(nextPage);
      } else {
        await loadPictures({ page, status: statusFilter === "all" ? "" : statusFilter });
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "গ্যালারি ডিলিট করা যায়নি।",
      );
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 p-4 sm:p-6 lg:p-8">
      <header>
        <h1 className="text-2xl font-bold text-fg sm:text-3xl">
          {view === "publish"
            ? "ছবি পাবলিশ"
            : view === "list"
              ? "ছবি লিস্ট"
              : "ছবি"}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-muted">
          কোনো ছবি ফাইল upload হবে না। শুধু গ্যালারি পেজের লিংক দিলে ওই series-এর সব ছবির
          লিংক ও তথ্য নিজে থেকেই সংরক্ষিত হবে — ছবিগুলো provider-এর CDN থেকেই দেখা যাবে।
        </p>
      </header>

      {/* ---- Stat strip: global counts, independent of the active page/filter ---- */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="মোট গ্যালারি" value={enToBnNumber(totalCount)} />
        <StatTile label="প্রকাশিত" value={enToBnNumber(publishedCount)} />
        <StatTile label="শিডিউলড" value={enToBnNumber(scheduledCount)} />
        <StatTile
          label="মোট ছবি"
          value={totalImages === null ? "—" : enToBnNumber(totalImages)}
        />
      </dl>

      {/*
        The combined "সব" view puts the publish form and the live gallery list
        side by side rather than stacking them: the form is what you act on,
        the list is what you compare against before publishing (to spot a
        gallery that is already there). On a wide screen the form sticks to
        the left while the list scrolls on the right.

        The single-purpose tabs keep the plain stacked layout — one job per
        screen, full width.
      */}
      <div
        className={
          view === "all"
            ? "grid gap-6 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:items-start"
            : "space-y-8"
        }
      >
      {/* ---- Create / edit form ------------------------------------------ */}
      {/* Shown on the publish tab and on the combined "সব" tab, and also on
          the list tab whenever an edit is in progress. */}
      {view === "publish" || view === "all" || editingId ? (
        <div className={view === "all" ? "lg:sticky lg:top-4" : undefined}>
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold text-fg">
              {editingId ? (
                <>
                  <Pencil className="h-4 w-4" />গ্যালারি এডিট করুন
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />নতুন ছবি গ্যালারি
                </>
              )}
            </h2>
            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-fg-muted transition hover:bg-surface-hover hover:text-fg"
              >
                <X className="h-3.5 w-3.5" />
                বাতিল
              </button>
            ) : null}
          </div>

          <PictureFormFields
            idPrefix={editingId ? "picture-edit" : "picture-new"}
            values={form}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          />

          {error ? (
            <p
              role="alert"
              className="rounded-xl bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300"
            >
              {error}
            </p>
          ) : null}
          {notice ? (
            <p
              role="status"
              className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300"
            >
              {notice}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={!!busy}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />সংরক্ষণ হচ্ছে...
                </>
              ) : editingId ? (
                "পরিবর্তন সংরক্ষণ করুন"
              ) : (
                "গ্যালারি প্রকাশ করুন"
              )}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-fg transition hover:bg-surface-hover"
              >
                বাতিল
              </button>
            ) : null}
          </div>
        </form>
        </div>
      ) : null}

      {/* ---- Gallery list ------------------------------------------------ */}
      {view === "list" || view === "all" ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-fg">
              <Images className="h-5 w-5" />
              গ্যালারি ({enToBnNumber(meta?.total ?? pictures.length)})
            </h2>
            <div
              className="flex items-center gap-1.5"
              role="group"
              aria-label="অবস্থা অনুযায়ী ফিল্টার"
            >
              {(
                [
                  { key: "all", label: "সব" },
                  { key: "published", label: "প্রকাশিত" },
                  { key: "scheduled", label: "শিডিউলড" },
                  { key: "draft", label: "ড্রাফট" },
                ] as const
              ).map((chip) => {
                const count =
                  chip.key === "all"
                    ? totalCount
                    : chip.key === "published"
                      ? publishedCount
                      : chip.key === "scheduled"
                        ? scheduledCount
                        : draftCount;
                const active = statusFilter === chip.key;
                return (
                  <button
                    key={chip.key}
                    type="button"
                    // Reset to page 1 whenever the filter changes — staying on
                    // page 7 of a 2-page filtered result would show "empty".
                    onClick={() => {
                      setStatusFilter(chip.key);
                      setPage(1);
                    }}
                    aria-pressed={active}
                    className={
                      active
                        ? "inline-flex items-center gap-1.5 rounded-full bg-fg px-3 py-1.5 text-xs font-semibold text-bg"
                        : "inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-fg-muted transition hover:bg-surface-hover hover:text-fg"
                    }
                  >
                    {chip.label}
                    <span className="tabular-nums opacity-70">{enToBnNumber(count)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-fg-muted">গ্যালারি লোড হচ্ছে...</p>
          ) : pictures.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-fg-muted">
              {statusFilter === "all"
                ? "এখনো কোনো ছবি গ্যালারি যোগ করা হয়নি।"
                : "এই ফিল্টারে কোনো গ্যালারি নেই।"}
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <ul role="list" className="divide-y divide-border">
                {pictures.map((picture) => (
                  <AdminPictureRow
                    key={picture.id}
                    picture={picture}
                    busy={busy === picture.id}
                    isEditing={editingId === picture.id}
                    onEdit={() => startEdit(picture)}
                    onToggleStatus={() => void updateStatus(picture)}
                    onDelete={() => void deletePicture(picture)}
                  />
                ))}
              </ul>
            </div>
          )}

          {/* ---- Pager: only when there's more than one page ---- */}
          {!loading && meta && meta.totalPages > 1 ? (
            <>
              <AdminPagination
                page={meta.page}
                totalPages={meta.totalPages}
                onPageChange={setPage}
              />
              <p className="text-center text-xs text-fg-subtle">
                পৃষ্ঠা {enToBnNumber(meta.page)} / {enToBnNumber(meta.totalPages)}
              </p>
            </>
          ) : null}
        </section>
      ) : null}
      </div>
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-3">
      <dt className="text-xs font-medium text-fg-muted">{label}</dt>
      <dd className="mt-1 text-xl font-bold tabular-nums text-fg">{value}</dd>
      {hint ? <p className="mt-0.5 text-[10px] text-amber-600">{hint}</p> : null}
    </div>
  );
}

/**
 * Admin gallery row — compact list, matching the video admin rows.
 *
 * Small cover on the left, title + model + count + status + date in the
 * middle, action chips on the right. The cover links to the public page.
 */
function AdminPictureRow({
  picture,
  busy,
  isEditing,
  onEdit,
  onToggleStatus,
  onDelete,
}: {
  picture: PictureGallery;
  busy: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  const isPublished = picture.status === "published";
  // A scheduled row is "published" in the DB but its publish time is still
  // in the future — that's what keeps it hidden from the public pages.
  const scheduledAt = picture.scheduled_at || null;
  const isScheduled =
    isPublished && !!scheduledAt && new Date(scheduledAt).getTime() > Date.now();
  const count = Number(picture.image_count) || picture.images?.length || 0;
  const ago = isScheduled
    ? `প্রকাশ ${formatDateTime(scheduledAt!)}`
    : picture.published_at
      ? formatDateTime(picture.published_at)
      : `তৈরি ${formatDateTime(picture.created_at)}`;

  return (
    <li
      className={
        isEditing
          ? "flex gap-3 bg-blue-500/[0.04] px-3 py-3 sm:gap-4 sm:px-4"
          : "flex gap-3 px-3 py-3 transition-colors hover:bg-surface-alt sm:gap-4 sm:px-4"
      }
    >
      {/* ---- Cover: portrait 3:4, fixed width so rows stay aligned ---- */}
      <a
        href={picture.public_slug ? `/image/${picture.public_slug}` : `/pictures/${picture.id}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${picture.title} পাবলিক পেজে খুলুন`}
        className="group relative block aspect-[3/4] w-20 shrink-0 overflow-hidden rounded-md bg-surface-alt sm:w-24"
      >
        {picture.cover_url ? (
          <Image
            src={picture.cover_url}
            alt=""
            fill
            sizes="96px"
            unoptimized
            className="object-cover transition-opacity group-hover:opacity-80"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-fg-subtle">
            <Images className="h-6 w-6" />
          </div>
        )}
      </a>

      {/* ---- Middle: title + model + meta, fills available space ---- */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="line-clamp-2 font-latin text-[14px] font-semibold leading-snug text-fg sm:text-[15px]">
            {picture.title}
          </h3>
          <span
            className={
              isScheduled
                ? "inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300"
                : isPublished
                  ? "inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
                  : "inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300"
            }
          >
            {isScheduled ? "শিডিউলড" : isPublished ? "প্রকাশিত" : "ড্রাফট"}
          </span>
        </div>

        {isScheduled ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <CountdownTimer target={scheduledAt!} />
          </div>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-fg-muted">
          {picture.model_name ? (
            <span className="truncate font-latin font-semibold text-fg">
              {picture.model_name}
            </span>
          ) : null}
          <span aria-hidden className="text-border/80">·</span>
          <span className="tabular-nums text-fg-subtle">
            {enToBnNumber(count)}টি ছবি
          </span>
          <span aria-hidden className="text-border/80">·</span>
          <span className="truncate">{ago}</span>
        </div>

        {picture.description ? (
          <p className="mt-1 line-clamp-2 font-latin text-[12px] leading-snug text-fg-muted sm:text-[13px]">
            {picture.description}
          </p>
        ) : null}

        {/* On mobile the action row drops below the description. */}
        <div className="mt-2 flex flex-wrap gap-1.5 sm:hidden">
          <ActionButtons
            busy={busy}
            isPublished={isPublished}
            picture={picture}
            onEdit={onEdit}
            onToggleStatus={onToggleStatus}
            onDelete={onDelete}
          />
        </div>
      </div>

      {/* ---- Right: actions, hidden on mobile (move below description) ---- */}
      <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
        <ActionButtons
          busy={busy}
          isPublished={isPublished}
          picture={picture}
          onEdit={onEdit}
          onToggleStatus={onToggleStatus}
          onDelete={onDelete}
        />
      </div>
    </li>
  );
}

/** Shared action chips — extracted so mobile and desktop renders match. */
function ActionButtons({
  busy,
  isPublished,
  picture,
  onEdit,
  onToggleStatus,
  onDelete,
}: {
  busy: boolean;
  isPublished: boolean;
  picture: PictureGallery;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <a
        href={picture.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 font-latin text-[11px] font-semibold text-fg transition hover:bg-surface-hover"
        title="provider-এর মূল গ্যালারি পেজ নতুন ট্যাবে খুলুন"
      >
        <ExternalLink className="h-3 w-3" />
        মূল লিংক
      </a>
      <CopySiteLink galleryId={picture.id} publicSlug={picture.public_slug} />
      <button
        type="button"
        disabled={busy}
        onClick={onEdit}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 font-latin text-[11px] font-semibold text-fg transition hover:bg-surface-hover disabled:opacity-50"
      >
        <Pencil className="h-3 w-3" />
        এডিট
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onToggleStatus}
        className="inline-flex h-7 items-center justify-center rounded-md border border-border px-2 font-latin text-[11px] font-semibold text-fg transition hover:bg-surface-hover disabled:opacity-50"
      >
        {busy ? "..." : isPublished ? "ড্রাফট করুন" : "প্রকাশ করুন"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onDelete}
        className="inline-flex h-7 items-center justify-center rounded-md border border-red-500/30 px-2 font-latin text-[11px] font-semibold text-red-600 transition hover:bg-red-500/10 disabled:opacity-50"
        aria-label={`${picture.title} ডিলিট করুন`}
        title="ডিলিট"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </>
  );
}

/**
 * Copies this gallery's public page URL on our own site, so an admin can
 * drop it straight into a story.
 *
 * Uses `window.location.origin` so it stays correct on localhost, staging
 * and production without a hardcoded domain.
 */
function CopySiteLink({
  galleryId,
  publicSlug,
}: {
  galleryId: string;
  publicSlug?: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    // New public URL when the gallery has a public slug; old URL otherwise.
    const path = publicSlug ? `/image/${publicSlug}` : `/pictures/${galleryId}`;
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API is unavailable on insecure origins — fall back to a
      // hidden textarea + execCommand so the button still works in dev.
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing else to try — the label will revert */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 font-latin text-[11px] font-semibold text-fg transition hover:bg-surface-hover"
      title="সাইটের গ্যালারি পেজের লিংক কপি করুন"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-emerald-600" />
          কপি হয়েছে
        </>
      ) : (
        <>
          <Link2 className="h-3 w-3" />
          লিংক কপি
        </>
      )}
    </button>
  );
}
