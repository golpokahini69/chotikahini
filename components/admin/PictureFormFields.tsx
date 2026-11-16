"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, User, ImageIcon, Tag, Layers } from "lucide-react";
import Image from "next/image";
import { formatDateTime } from "@/lib/utils";

/**
 * Gallery form fields for the admin picture section.
 *
 * The admin pastes ONE gallery URL and the server scrapes everything else:
 * every image URL (full-size + thumbnail), the title, the model, the
 * channel, the categories and the tags. Nothing has to be typed by hand.
 *
 * Like the video form, fields the admin has personally edited are locked
 * against auto-overwrite, so the form never fights the admin. "তথ্য আবার
 * আনুন" forces a refresh.
 */

export interface PictureImageValue {
  url: string;
  thumb: string;
  width: number | null;
  height: number | null;
}

export interface PictureFormValues {
  sourceUrl: string;
  title: string;
  description: string;
  coverUrl: string;
  images: PictureImageValue[];
  modelName: string;
  channelName: string;
  categories: string[];
  tags: string[];
  sourceViews: number | null;
  /**
   * Future publish time as an ISO string, or "" for "publish now".
   * The admin form renders it in a `datetime-local` input, so the value
   * lives in the form as a local-time string and is converted to ISO
   * when it is sent to the API.
   */
  scheduledAt: string;
}

interface Props {
  values: PictureFormValues;
  onChange: (patch: Partial<PictureFormValues>) => void;
  idPrefix: string;
  /**
   * The id of the gallery whose URL is already published, when the URL in
   * the form points at a gallery that already exists. The manager fills
   * this in from the API's duplicate response so the admin is warned
   * before they can even submit.
   */
  duplicateOfId?: string | null;
}

const META_DEBOUNCE_MS = 700;

export function PictureFormFields({
  values,
  onChange,
  idPrefix,
  duplicateOfId = null,
}: Props) {
  // Fields the admin has personally typed in are locked against auto-fill.
  const touched = useRef({
    title: false,
    description: false,
    coverUrl: false,
    modelName: false,
    channelName: false,
  });

  const [loading, setLoading] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PictureImageValue[]>([]);

  // Server-side scrape, debounced on the gallery URL field.
  useEffect(() => {
    const url = values.sourceUrl.trim();
    if (!url) {
      setPreview([]);
      setMetaError(null);
      return;
    }

    const handle = window.setTimeout(async () => {
      setLoading(true);
      setMetaError(null);
      try {
        const res = await fetch(
          `/api/picture-metadata?url=${encodeURIComponent(url)}`,
        );
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setMetaError(data?.error || "গ্যালারির তথ্য আনা যায়নি।");
          return;
        }
        if (!data || typeof data !== "object") return;

        const patch: Partial<PictureFormValues> = {};

        if (Array.isArray(data.images) && data.images.length > 0) {
          const images = data.images as PictureImageValue[];
          setPreview(images);
          patch.images = images;
          if (!touched.current.coverUrl && data.coverUrl) {
            patch.coverUrl = data.coverUrl;
          }
        } else {
          setPreview([]);
        }

        if (typeof data.title === "string" && data.title && !touched.current.title) {
          patch.title = data.title;
        }
        if (
          typeof data.description === "string" &&
          data.description &&
          !touched.current.description
        ) {
          patch.description = data.description;
        }
        if (
          typeof data.modelName === "string" &&
          data.modelName &&
          !touched.current.modelName
        ) {
          patch.modelName = data.modelName;
        }
        if (
          typeof data.channelName === "string" &&
          data.channelName &&
          !touched.current.channelName
        ) {
          patch.channelName = data.channelName;
        }
        if (Array.isArray(data.categories) && data.categories.length > 0) {
          patch.categories = data.categories;
        }
        if (Array.isArray(data.tags) && data.tags.length > 0) {
          patch.tags = data.tags;
        }
        if (typeof data.sourceViews === "number") {
          patch.sourceViews = data.sourceViews;
        }

        if (Object.keys(patch).length > 0) onChange(patch);
      } catch {
        setMetaError("গ্যালারির তথ্য আনা যায়নি।");
      } finally {
        setLoading(false);
      }
    }, META_DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.sourceUrl]);

  const runManualExtract = () => {
    const url = values.sourceUrl.trim();
    if (!url) return;

    setLoading(true);
    setMetaError(null);
    fetch(`/api/picture-metadata?url=${encodeURIComponent(url)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok) {
          throw new Error(data?.error || "গ্যালারির তথ্য আনা যায়নি।");
        }
        return data;
      })
      .then((data) => {
        if (!data || typeof data !== "object") return;
        const patch: Partial<PictureFormValues> = {};
        if (Array.isArray(data.images) && data.images.length > 0) {
          setPreview(data.images);
          patch.images = data.images;
          if (!touched.current.coverUrl && data.coverUrl) {
            patch.coverUrl = data.coverUrl;
          }
        }
        if (data.title && !touched.current.title) patch.title = data.title;
        if (data.description && !touched.current.description) {
          patch.description = data.description;
        }
        if (data.modelName && !touched.current.modelName) {
          patch.modelName = data.modelName;
        }
        if (data.channelName && !touched.current.channelName) {
          patch.channelName = data.channelName;
        }
        if (Array.isArray(data.categories) && data.categories.length > 0) {
          patch.categories = data.categories;
        }
        if (Array.isArray(data.tags) && data.tags.length > 0) {
          patch.tags = data.tags;
        }
        if (typeof data.sourceViews === "number") {
          patch.sourceViews = data.sourceViews;
        }
        if (Object.keys(patch).length > 0) onChange(patch);
      })
      .catch((error) => {
        setMetaError(
          error instanceof Error
            ? error.message
            : "গ্যালারির তথ্য আনা যায়নি।",
        );
      })
      .finally(() => setLoading(false));
  };

  return (
    <>
      <label
        className="block space-y-1.5 text-sm font-medium text-fg"
        htmlFor={`${idPrefix}-source`}
      >
        গ্যালারি লিংক
        <input
          id={`${idPrefix}-source`}
          type="url"
          inputMode="url"
          value={values.sourceUrl}
          onChange={(e) => onChange({ sourceUrl: e.target.value })}
          maxLength={2048}
          required
          className="input-field w-full"
          placeholder="https://www.pornpics.com/galleries/... · https://www.babehub.com/... · https://www.elitebabes.com/... · https://www.babesource.com/... · https://multi.pornchat.com/gallery/..."
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!values.sourceUrl.trim() || loading}
            onClick={runManualExtract}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-fg-muted transition hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className="h-3 w-3" />
            তথ্য আবার আনুন
          </button>
          {loading ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-muted">
              <Loader2 className="h-3 w-3 animate-spin" />
              তথ্য আনা হচ্ছে…
            </span>
          ) : null}
          <span className="text-[11px] text-fg-muted">
            লিংক দিলেই গ্যালেরির সব ছবির লিংক ও তথ্য নিজে থেকে বসে যাবে। যেকোনো
            গ্যালেরি সাইটের লিংক চলবে — যেমন PornPics, Babehub, Elitebabes,
            Femjoyhunter, BabeSource, PornChat।
          </span>
        </div>
        {duplicateOfId ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[12px] text-amber-800 dark:text-amber-200">
            এই গ্যালেরিটি ইতিমধ্যে পাবলিশ করা আছে। একই গ্যালেরি দুইবার
            পাবলিশ করা যাবে না।
          </p>
        ) : null}
      </label>

      {metaError ? (
        <p
          role="alert"
          className="rounded-xl bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300"
        >
          {metaError}
        </p>
      ) : null}

      {/* ---- Scrape preview: what was found, before anything is saved ---- */}
      {preview.length > 0 ? (
        <div className="rounded-2xl border border-border bg-surface-alt/40 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            <ImageIcon className="h-4 w-4" />
            {preview.length.toLocaleString("en-US")}টি ছবি পাওয়া গেছে
          </p>
          <p className="mt-1 text-[11px] text-fg-muted">
            শুধু ছবির লিংক ও তথ্য সংরক্ষিত হবে — কোনো ছবি ফাইল আমাদের সার্ভারে সেভ হবে না।
          </p>

          <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {preview.slice(0, 10).map((image, index) => (
              <div
                key={`${image.url}-${index}`}
                className="relative aspect-[3/4] overflow-hidden rounded-md bg-surface-alt"
              >
                <Image
                  src={image.thumb || image.url}
                  alt=""
                  fill
                  unoptimized
                  sizes="120px"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
          {preview.length > 10 ? (
            <p className="mt-2 text-[11px] text-fg-subtle">
              আরও {preview.length - 10}টি ছবি আছে…
            </p>
          ) : null}

          {(values.modelName || values.channelName) && (
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-muted">
              {values.modelName ? (
                <span className="inline-flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {values.modelName}
                </span>
              ) : null}
              {values.channelName ? (
                <span className="inline-flex items-center gap-1">
                  <Layers className="h-3 w-3" />
                  {values.channelName}
                </span>
              ) : null}
            </p>
          )}

          {values.tags.length > 0 ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-fg-muted">
              <Tag className="h-3 w-3 shrink-0" />
              {values.tags.slice(0, 10).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <label
        className="block space-y-1.5 text-sm font-medium text-fg"
        htmlFor={`${idPrefix}-title`}
      >
        গ্যালারির শিরোনাম
        <input
          id={`${idPrefix}-title`}
          value={values.title}
          onChange={(e) => {
            touched.current.title = true;
            onChange({ title: e.target.value });
          }}
          maxLength={200}
          required
          className="input-field w-full font-latin"
          placeholder="লিংক দিলে auto-fill হবে; না থাকলে লিখুন"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label
          className="block space-y-1.5 text-sm font-medium text-fg"
          htmlFor={`${idPrefix}-model`}
        >
          মডেল / পারফর্মারের নাম
          <input
            id={`${idPrefix}-model`}
            value={values.modelName}
            onChange={(e) => {
              touched.current.modelName = true;
              onChange({ modelName: e.target.value });
            }}
            maxLength={120}
            className="input-field w-full font-latin"
            placeholder="যেমন: Becky Wunder"
          />
        </label>

        <label
          className="block space-y-1.5 text-sm font-medium text-fg"
          htmlFor={`${idPrefix}-channel`}
        >
          চ্যানেল / স্টুডিও
          <input
            id={`${idPrefix}-channel`}
            value={values.channelName}
            onChange={(e) => {
              touched.current.channelName = true;
              onChange({ channelName: e.target.value });
            }}
            maxLength={120}
            className="input-field w-full font-latin"
            placeholder="যেমন: Playboy Plus"
          />
        </label>
      </div>

      <label
        className="block space-y-1.5 text-sm font-medium text-fg"
        htmlFor={`${idPrefix}-desc`}
      >
        সংক্ষিপ্ত বিবরণ <span className="font-normal text-fg-muted">(ঐচ্ছিক)</span>
        <textarea
          id={`${idPrefix}-desc`}
          value={values.description}
          onChange={(e) => {
            touched.current.description = true;
            onChange({ description: e.target.value });
          }}
          maxLength={500}
          rows={3}
          className="input-field w-full resize-y"
          placeholder="গ্যালারি সম্পর্কে লিখুন"
        />
      </label>

      <label
        className="block space-y-1.5 text-sm font-medium text-fg"
        htmlFor={`${idPrefix}-cover`}
      >
        কভার ছবির HTTPS URL
        <input
          id={`${idPrefix}-cover`}
          type="url"
          inputMode="url"
          value={values.coverUrl}
          onChange={(e) => {
            touched.current.coverUrl = true;
            onChange({ coverUrl: e.target.value });
          }}
          maxLength={2048}
          required
          className="input-field w-full"
          placeholder="https://.../1280/...jpg"
        />
        <span className="block text-xs font-normal leading-5 text-fg-muted">
          গ্যালারির প্রথম ছবিটাই কভার হিসেবে বসে থাকে।
        </span>
      </label>

      {/* ---- Scheduled publishing ----------------------------------------
          Empty = publish right away. A future date parks the gallery until
          that moment arrives; the public pages hide it until then. */}
      <div className="rounded-xl border border-border bg-surface-alt/40 p-3">
        <label
          className="block space-y-1.5 text-sm font-medium text-fg"
          htmlFor={`${idPrefix}-schedule`}
        >
          শিডিউল করা প্রকাশ
          <span className="font-normal text-fg-muted">
            (ঐচ্ছিক — খালি রাখলে এখনই প্রকাশ হবে)
          </span>
          <input
            id={`${idPrefix}-schedule`}
            type="datetime-local"
            value={values.scheduledAt}
            onChange={(e) => onChange({ scheduledAt: e.target.value })}
            className="input-field w-full"
          />
        </label>
        {values.scheduledAt &&
        new Date(values.scheduledAt).getTime() > Date.now() ? (
          <p className="mt-1.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">
            নির্ধারিত সময়: {formatDateTime(values.scheduledAt)} — এই সময়ের আগে
            গ্যালারিটি পাবলিকভাবে দেখা যাবে না।
          </p>
        ) : null}
      </div>
    </>
  );
}
