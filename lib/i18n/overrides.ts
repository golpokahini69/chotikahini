import type { Locale } from "./locale";
import type { NavItem } from "@/lib/config";

/**
 * English labels for navigation entries whose text lives in the database.
 *
 * The nav is stored in `site_settings.navigation` as plain strings
 * (`{ href, label }`) and is editable by an admin. Rather than changing the
 * stored shape — which would break `mergeNavigation`'s href-based matching
 * in `lib/config.ts` — the English label for a known route is curated here.
 *
 * A route with no entry here falls back to a slug-derived label, so the UI
 * is never blank.
 */
export const NAV_LABEL_OVERRIDES: Record<string, { en: string }> = {
  "/": { en: "Home" },
  "/posts": { en: "Posts" },
  "/tags": { en: "Tags" },
  "/series": { en: "Series" },
  "/videos": { en: "Videos" },
  "/pictures": { en: "Pictures" },
  "/authors": { en: "Authors" },
  "/chat": { en: "Chat" },
  "/contact": { en: "Contact" },
  "/privacy": { en: "Privacy" },
  "/featured": { en: "Featured" },
  "/search": { en: "Search" },
  "/profile": { en: "Profile" },
  "/categories": { en: "Categories" },
  "/archive": { en: "Archive" },
};

/**
 * English names for categories.
 *
 * Category rows live in the `categories` table with Bangla names; the
 * English label is curated here, keyed by the category id.
 */
export const CATEGORY_NAME_OVERRIDES: Record<string, { en: string }> = {
  golpo: { en: "Stories" },
  hot: { en: "Hot Stories" },
  bodhu: { en: "Housewife" },
  tarona: { en: "Older Partners" },
  obibahito: { en: "Unmarried" },
  bibahito: { en: "Married" },
  porokiya: { en: "Affairs" },
  kumari: { en: "Maidens" },
  prem: { en: "Romance" },
  pesha: { en: "Professionals" },
  paribarik: { en: "Family" },
  somokami: { en: "Homosexual" },
  aloukik: { en: "Supernatural" },
};

/**
 * Turn a path into a readable label, used when no curated override exists.
 * "/quizzes" → "Quizzes", "/my-section" → "My Section".
 */
export function slugToLabel(href: string): string {
  const segment = href.split("/").filter(Boolean).pop();
  if (!segment) return "Home";
  return segment
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Localise a navigation item.
 *
 * For Bangla the database label is returned untouched — the Bangla site
 * keeps rendering exactly what the admin configured.
 */
export function localizeNavItem(item: NavItem, locale: Locale): NavItem {
  if (locale === "bn") return item;
  const override = NAV_LABEL_OVERRIDES[item.href]?.en;
  if (override) return { ...item, label: override };
  return { ...item, label: slugToLabel(item.href) };
}

/** Localise a whole navigation list. */
export function localizeNavItems(
  items: NavItem[],
  locale: Locale,
): NavItem[] {
  if (locale === "bn") return items;
  return items.map((item) => localizeNavItem(item, locale));
}

/** Localise a category name by its id, with a slug-derived fallback. */
export function localizeCategoryName(
  id: string,
  name: string | undefined,
  locale: Locale,
): string {
  if (locale === "bn") return name || id;
  const override = CATEGORY_NAME_OVERRIDES[id]?.en;
  if (override) return override;
  return name || slugToLabel(id);
}
