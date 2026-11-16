import type { MessageKey } from "./keys";

/**
 * The English message catalogue.
 *
 * Typed as `Record<MessageKey, string>` — so if a key is added to
 * `lib/i18n/keys.ts` and not translated here, the build fails with a type
 * error rather than shipping a blank label.
 */
export const en: Record<MessageKey, string> = {
  // ── Navigation ────────────────────────────────────────────────────────
  "nav.home": "Home",
  "nav.posts": "Posts",
  "nav.tags": "Tags",
  "nav.series": "Series",
  "nav.videos": "Videos",
  "nav.pictures": "Pictures",
  "nav.authors": "Authors",
  "nav.chat": "Chat",
  "nav.contact": "Contact",
  "nav.privacy": "Privacy",

  // ── Header ────────────────────────────────────────────────────────────
  "header.search": "Search",
  "header.login": "Log in",
  "header.profile": "Profile",
  "header.menuOpen": "Open menu",
  "header.menuClose": "Close menu",
  "header.lightMode": "Switch to light mode",
  "header.darkMode": "Switch to dark mode",
  "header.homeAria": "Home",
  "header.notifications": "Notifications",

  // ── Bottom nav ────────────────────────────────────────────────────────
  "bottomNav.home": "Home",
  "bottomNav.tags": "Tags",
  "bottomNav.search": "Search",
  "bottomNav.notifications": "Notifications",
  "bottomNav.profile": "Profile",
  "bottomNav.login": "Log in",

  // ── Footer ────────────────────────────────────────────────────────────
  "footer.rights": "All rights reserved",
  "footer.followUs": "Follow us",
  "footer.language": "Language",
  "footer.allRightsReserved": "All rights reserved.",

  // ── Language switcher ─────────────────────────────────────────────────
  "switcher.label": "Switch to English",
  "switcher.toEnglish": "Switch to English",
  "switcher.toBangla": "Switch to Bangla",

  // ── Pagination ────────────────────────────────────────────────────────
  "pagination.previousPage": "Previous page",
  "pagination.nextPage": "Next page",
  "pagination.previous": "Previous",
  "pagination.next": "Next",
  "pagination.pageOf": "Page {n} of {m}",
  "pagination.page": "Page {n}",

  // ── Home ──────────────────────────────────────────────────────────────
  "home.videosAndStories": "Videos & Stories",
  "home.videos": "Videos",
  "home.pictures": "Pictures",
  "home.stories": "Stories",
  "home.featuredStories": "Featured Stories",
  "home.thisWeekBest": "Best reads this week",
  "home.allFeatured": "All featured",
  "home.latestStories": "Latest Stories",
  "home.latestCount": "From {count} stories in total",
  "home.noStoriesTitle": "Nothing to read yet",
  "home.noStoriesBody": "No stories have been published just yet.",
  "home.browseAll": "Browse all",
  "home.seoHeading": "Bengali Erotic Stories & Videos",
  "home.seoBody1":
    "A collection of Bengali erotic stories, affairs and serial tales — browse and read at your own pace.",
  "home.seoBody2":
    "New Bengali stories are published every day, so there is always something fresh to read.",
  "home.disclaimer":
    "Every story on this site is entirely fictional. All published tales are works of imagination.",

  // ── Story detail ──────────────────────────────────────────────────────
  "story.notFound": "Story not found",
  "story.pendingTitle": "Pending Approval",
  "story.pendingBody":
    "This story has not yet been approved and published by an admin. Only you as the author and the admins can see it.",
  "story.author": "Author",
  "story.viewProfile": "Profile",
  "story.readingTime": "Reading time",
  "story.relatedStories": "Related stories",
  "story.tags": "Tags",
  "story.share": "Share",
  "story.previous": "Previous story",
  "story.next": "Next story",
  "story.copyLink": "Copy link",
  "story.copied": "Copied",

  // ── About ─────────────────────────────────────────────────────────────
  "about.title": "About — Choti Kahini",
  "about.intro":
    "Choti Kahini — a collection of Bengali erotic stories, affairs and serial tales.",
  "about.authorsHeading": "Our Authors",
  "about.website": "Website",
  "about.contact": "Contact",
  "about.heading": "Introduction",

  // ── Posts ─────────────────────────────────────────────────────────────
  "posts.title": "Posts — Choti Kahini",
  "posts.heading": "All Posts",
  "posts.subheading": "Every community post, gathered in one place",
  "posts.empty": "No posts yet",

  // ── Tags ──────────────────────────────────────────────────────────────
  "tags.title": "Tags — Choti Kahini",
  "tags.heading": "All Tags",
  "tags.subheading": "Find stories by topic",
  "tags.browseAll": "Browse all tags",
  "tags.empty": "No tags found",

  // ── Categories ────────────────────────────────────────────────────────
  "categories.title": "Categories — Choti Kahini",
  "categories.heading": "All Categories",
  "categories.empty": "No stories found",

  // ── Search ────────────────────────────────────────────────────────────
  "search.title": "Search — Choti Kahini",
  "search.heading": "Search stories",
  "search.placeholder": "Search stories, authors or tags…",
  "search.button": "Search",
  "search.empty": "No results found",
  "search.error": "Something went wrong while searching. Please try again.",
  "search.resultsCount": "{count} results",
  "search.clear": "Clear",
  "search.filters": "Filters",
  "search.advancedFilters": "Advanced filters",
  "search.clearFilters": "Clear all filters",
  "search.category": "Category",
  "search.allCategories": "All categories",
  "search.tag": "Tag",
  "search.tagPlaceholder": "e.g. Romance, Thriller",
  "search.author": "Author",
  "search.authorPlaceholder": "Author name or username",
  "search.searching": "Searching…",

  // ── Sidebar ───────────────────────────────────────────────────────────
  "sidebar.trending": "Trending stories",
  "sidebar.categories": "Categories",
  "sidebar.tags": "Tags",
  "sidebar.archive": "Archive",
  "sidebar.author": "Author",
  "sidebar.aboutAuthor": "About the author",
  "sidebar.moreStories": "More stories",
  "sidebar.relatedPosts": "Related posts",

  // ── Post card ─────────────────────────────────────────────────────────
  "post.readMore": "Read more",
  "post.readingTime": "min read",
  "post.by": "by",

  // ── Profile ───────────────────────────────────────────────────────────
  "profile.title": "Profile — Choti Kahini",
  "profile.myPosts": "My posts",
  "profile.saved": "Saved",
  "profile.likes": "Likes",
  "profile.history": "History",
  "profile.settings": "Settings",
  "profile.noPosts": "No posts yet",
  "profile.loginRequired": "Please log in to see this",

  // ── Contact ───────────────────────────────────────────────────────────
  "contact.title": "Contact — Choti Kahini",
  "contact.heading": "Get in touch",
  "contact.name": "Your name",
  "contact.email": "Email",
  "contact.subject": "Subject",
  "contact.message": "Message",
  "contact.send": "Send",
  "contact.sending": "Sending…",
  "contact.success": "Your message has been sent.",
  "contact.error": "Your message could not be sent. Please try again.",

  // ── Common ────────────────────────────────────────────────────────────
  "common.loading": "Loading…",
  "common.error": "Something went wrong",
  "common.retry": "Try again",
  "common.backHome": "Back to home",
  "common.readMore": "Read more",
  "common.notFoundTitle": "Page not found",
  "common.notFoundBody":
    "The page you are looking for has been moved, or never existed.",
  "common.more": "More",
  "common.viewAll": "View all",
};
