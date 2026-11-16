/**
 * Locale primitives for the bilingual site.
 *
 * Two locales:
 *   "bn" — Bangla, served from the root path (`/`, `/some-story`)
 *   "en" — English, served from `/en` (`/en`, `/en/some-story`)
 *
 * The locale is ALWAYS known statically — it comes from the route segment,
 * never from a cookie or a request header. That keeps every page statically
 * renderable / ISR-cacheable (a `cookies()` or `headers()` read in the root
 * layout would force the entire site to render on demand).
 */
export type Locale = "bn" | "en";

export const LOCALES: readonly Locale[] = ["bn", "en"] as const;

/** Bangla is the default locale and lives at the root of the site. */
export const DEFAULT_LOCALE: Locale = "bn";

/** The URL prefix each locale lives under. Bangla uses none. */
export const LOCALE_PREFIX: Record<Locale, string> = {
  bn: "",
  en: "/en",
};

export function isLocale(value: unknown): value is Locale {
  return value === "bn" || value === "en";
}

/** Map a BCP-47 tag ("en-US", "bn-BD") down to one of our two locales. */
export function toLocale(tag: unknown): Locale {
  if (typeof tag !== "string") return DEFAULT_LOCALE;
  const lower = tag.toLowerCase();
  if (lower.startsWith("en")) return "en";
  if (lower.startsWith("bn") || lower.startsWith("be")) return "bn";
  return DEFAULT_LOCALE;
}
