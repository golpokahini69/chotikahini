"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, SlidersHorizontal } from "lucide-react";
import type { PostMeta } from "@/lib/posts";
import { PostCard } from "./PostCard";
import { AdSlot } from "./AdSlot";
import { useLocale } from "@/components/providers/LocaleProvider";
import { useTranslations } from "@/lib/i18n/use-translations";
import { localizeCategoryName } from "@/lib/i18n/overrides";

import { AD_300x250_HTML } from "@/lib/ad-config";

const SEARCH_AD_HTML = AD_300x250_HTML;

const KNOWN_CATEGORIES = [
  { id: "golpo", name: "গল্প" },
  { id: "hot", name: "গরম গল্প" },
  { id: "prem", name: "প্রেম" },
  { id: "real", name: "রিয়াল লাইফ" },
  { id: "aloukik", name: "অলৌকিক" },
  { id: "thriller", name: "থ্রিলার" },
  { id: "romance", name: "রোমান্স" },
];

export function SearchInput() {
  const locale = useLocale();
  const t = useTranslations();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [tag, setTag] = useState("");
  const [author, setAuthor] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<PostMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // NOTE: the API path is intentionally NOT locale-prefixed — `/api/*` is
  // excluded from `localizeHref` so requests always hit the same endpoint.
  const buildUrl = useCallback((value: string, cat: string, tg: string, auth: string) => {
    const params = new URLSearchParams();
    if (value.trim().length >= 1) params.set("q", value.trim());
    if (cat) params.set("category", cat);
    if (tg) params.set("tag", tg);
    if (auth) params.set("author", auth);
    return `/api/search?${params.toString()}`;
  }, []);

  const runSearch = useCallback(
    async (value: string, cat: string, tg: string, auth: string) => {
      abortRef.current?.abort();
      const hasAny = value.trim().length >= 1 || cat || tg || auth;
      if (!hasAny) {
        setResults([]);
        setLoading(false);
        setError("");
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError("");

      try {
        const res = await fetch(buildUrl(value, cat, tg, auth), {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Search request failed");
        const data: PostMeta[] = await res.json();
        setResults(data);
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
          setError(t("search.error"));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [buildUrl, t],
  );

  useEffect(() => {
    const id = setTimeout(() => runSearch(query, category, tag, author), 250);
    return () => clearTimeout(id);
  }, [query, category, tag, author, runSearch]);

  const clearAll = () => {
    setQuery("");
    setCategory("");
    setTag("");
    setAuthor("");
    setResults([]);
    setError("");
  };

  return (
    <div className="space-y-8">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-subtle" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search.placeholder")}
          aria-label={t("search.placeholder")}
          className="input-field pl-11 pr-20 py-3.5 text-sm placeholder:text-fg-subtle"
          autoFocus
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {(query || category || tag || author) && (
            <button
              onClick={clearAll}
              className="p-1.5 text-fg-subtle hover:text-fg transition-colors"
              aria-label={t("search.clearFilters")}
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-semibold ${
              showFilters || category || tag || author
                ? "bg-accent/10 text-accent"
                : "text-fg-subtle hover:text-fg hover:bg-surface-hover"
            }`}
            title={t("search.advancedFilters")}
            aria-label={t("search.advancedFilters")}
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">{t("search.filters")}</span>
          </button>
        </div>
      </div>

      {/* Advanced Filters */}
      {showFilters && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-surface border border-border rounded-2xl animate-fade-in">
          <div>
            <label className="block text-[11px] font-bold text-fg-muted uppercase tracking-wider mb-1.5">
              {t("search.category")}
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="input-field"
              aria-label={t("search.category")}
            >
              <option value="">{t("search.allCategories")}</option>
              {KNOWN_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {localizeCategoryName(c.id, c.name, locale)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-fg-muted uppercase tracking-wider mb-1.5">
              {t("search.tag")}
            </label>
            <input
              type="text"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder={t("search.tagPlaceholder")}
              aria-label={t("search.tag")}
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-fg-muted uppercase tracking-wider mb-1.5">
              {t("search.author")}
            </label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder={t("search.authorPlaceholder")}
              aria-label={t("search.author")}
              className="input-field"
            />
          </div>
        </div>
      )}

      {(category || tag || author) && !showFilters && (
        <div className="flex flex-wrap gap-2">
          {category && (
            <button onClick={() => setCategory("")} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent/10 text-accent text-xs font-semibold">
              {t("search.category")}: {category} <X className="w-3 h-3" />
            </button>
          )}
          {tag && (
            <button onClick={() => setTag("")} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent/10 text-accent text-xs font-semibold">
              {t("search.tag")}: {tag} <X className="w-3 h-3" />
            </button>
          )}
          {author && (
            <button onClick={() => setAuthor("")} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent/10 text-accent text-xs font-semibold">
              {t("search.author")}: {author} <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {loading && (
        <p className="text-sm text-fg-subtle">{t("search.searching")}</p>
      )}

      {!loading && error && (
        <div className="text-center py-16 rounded-2xl border border-border bg-surface-alt">
          <p className="text-sm text-fg-muted">{error}</p>
        </div>
      )}

      {!loading && !error && (query || category || tag || author) && results.length === 0 && (
        <div className="text-center py-16 rounded-2xl border border-border bg-surface-alt">
          <p className="text-sm text-fg-muted">
            {query ? `&ldquo;${query}&rdquo; &mdash; ` : ""}
            {t("search.empty")}
          </p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <p className="text-sm text-fg-muted">
          {t("search.resultsCount", { count: results.length })}
        </p>
      )}

      {results.length > 0 && (
        <div className="card-grid">
          {results.flatMap((post, index) => {
            const items: React.ReactNode[] = [
              <PostCard key={post.uid || post.slug} post={post} locale={locale} />,
            ];
            if ((index + 1) % 4 === 0) {
              items.push(
                <AdSlot key={`search-ad-${index}`} id={`search-ad-${index}`} html={SEARCH_AD_HTML} />,
              );
            }
            return items;
          })}
        </div>
      )}
    </div>
  );
}
