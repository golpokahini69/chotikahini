/**
 * The single source of truth for every translatable UI string.
 *
 * `messageKeys` drives the `MessageKey` union, and `bn.ts` / `en.ts` are
 * typed against it. Because `en.ts` is typed as `Record<MessageKey, string>`,
 * a missing English string is a **compile error** rather than a blank label
 * shipped to production.
 */
export const messageKeys = [
  // ── Navigation ────────────────────────────────────────────────────────
  "nav.home",
  "nav.posts",
  "nav.tags",
  "nav.series",
  "nav.videos",
  "nav.pictures",
  "nav.authors",
  "nav.chat",
  "nav.contact",
  "nav.privacy",

  // ── Header ────────────────────────────────────────────────────────────
  "header.search",
  "header.login",
  "header.profile",
  "header.menuOpen",
  "header.menuClose",
  "header.lightMode",
  "header.darkMode",
  "header.homeAria",
  "header.notifications",

  // ── Bottom nav ────────────────────────────────────────────────────────
  "bottomNav.home",
  "bottomNav.tags",
  "bottomNav.search",
  "bottomNav.notifications",
  "bottomNav.profile",
  "bottomNav.login",

  // ── Footer ────────────────────────────────────────────────────────────
  "footer.rights",
  "footer.followUs",
  "footer.language",
  "footer.allRightsReserved",

  // ── Language switcher ─────────────────────────────────────────────────
  "switcher.label",
  "switcher.toEnglish",
  "switcher.toBangla",

  // ── Pagination ────────────────────────────────────────────────────────
  "pagination.previousPage",
  "pagination.nextPage",
  "pagination.previous",
  "pagination.next",
  "pagination.pageOf",
  "pagination.page",

  // ── Home ──────────────────────────────────────────────────────────────
  "home.videosAndStories",
  "home.videos",
  "home.pictures",
  "home.stories",
  "home.featuredStories",
  "home.thisWeekBest",
  "home.allFeatured",
  "home.latestStories",
  "home.latestCount",
  "home.noStoriesTitle",
  "home.noStoriesBody",
  "home.browseAll",
  "home.seoHeading",
  "home.seoBody1",
  "home.seoBody2",
  "home.disclaimer",

  // ── Story detail ──────────────────────────────────────────────────────
  "story.notFound",
  "story.pendingTitle",
  "story.pendingBody",
  "story.author",
  "story.viewProfile",
  "story.readingTime",
  "story.relatedStories",
  "story.tags",
  "story.share",
  "story.previous",
  "story.next",
  "story.copyLink",
  "story.copied",

  // ── About ─────────────────────────────────────────────────────────────
  "about.title",
  "about.intro",
  "about.authorsHeading",
  "about.website",
  "about.contact",
  "about.heading",

  // ── Posts ─────────────────────────────────────────────────────────────
  "posts.title",
  "posts.heading",
  "posts.subheading",
  "posts.empty",

  // ── Tags ──────────────────────────────────────────────────────────────
  "tags.title",
  "tags.heading",
  "tags.subheading",
  "tags.browseAll",
  "tags.empty",

  // ── Categories ────────────────────────────────────────────────────────
  "categories.title",
  "categories.heading",
  "categories.empty",

  // ── Search ────────────────────────────────────────────────────────────
  "search.title",
  "search.heading",
  "search.placeholder",
  "search.button",
  "search.empty",
  "search.error",
  "search.resultsCount",
  "search.clear",
  "search.filters",
  "search.advancedFilters",
  "search.clearFilters",
  "search.category",
  "search.allCategories",
  "search.tag",
  "search.tagPlaceholder",
  "search.author",
  "search.authorPlaceholder",
  "search.searching",

  // ── Sidebar ───────────────────────────────────────────────────────────
  "sidebar.trending",
  "sidebar.categories",
  "sidebar.tags",
  "sidebar.archive",
  "sidebar.author",
  "sidebar.aboutAuthor",
  "sidebar.moreStories",
  "sidebar.relatedPosts",

  // ── Post card ─────────────────────────────────────────────────────────
  "post.readMore",
  "post.readingTime",
  "post.by",

  // ── Profile ───────────────────────────────────────────────────────────
  "profile.title",
  "profile.myPosts",
  "profile.saved",
  "profile.likes",
  "profile.history",
  "profile.settings",
  "profile.noPosts",
  "profile.loginRequired",

  // ── Contact ───────────────────────────────────────────────────────────
  "contact.title",
  "contact.heading",
  "contact.name",
  "contact.email",
  "contact.subject",
  "contact.message",
  "contact.send",
  "contact.sending",
  "contact.success",
  "contact.error",

  // ── Common ────────────────────────────────────────────────────────────
  "common.loading",
  "common.error",
  "common.retry",
  "common.backHome",
  "common.readMore",
  "common.notFoundTitle",
  "common.notFoundBody",
  "common.more",
  "common.viewAll",
] as const;

export type MessageKey = (typeof messageKeys)[number];

/**
 * Interpolation parameters, keyed by message key.
 *
 * Only keys that actually contain a `{placeholder}` need an entry. The
 * `ParamsFor` helper below resolves every other key to `undefined`, so
 * `t(key)` is valid for all of them and `t(key, params)` is only offered
 * for the keys that declare parameters.
 */
export interface MessageParams {
  "pagination.pageOf": { n: string | number; m: string | number };
  "pagination.page": { n: string | number };
  "home.latestCount": { count: string | number };
  "search.resultsCount": { count: string | number };
}

/**
 * The parameter type accepted for a given message key.
 *
 * Keys without a declared parameter set resolve to `undefined`, which keeps
 * `t("nav.home")` valid while still type-checking `t("pagination.pageOf", { n, m })`.
 */
export type ParamsFor<K extends MessageKey> = K extends keyof MessageParams
  ? MessageParams[K]
  : undefined;
