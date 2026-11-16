import type { MessageKey } from "./keys";

/**
 * The Bangla message catalogue.
 *
 * These are the strings that are currently hardcoded across the app. Moving
 * them here (rather than translating them) means the Bangla site renders
 * byte-for-byte the same text it did before — this file is a faithful
 * extraction, not a rewrite.
 */
export const bn: Record<MessageKey, string> = {
  // ── Navigation ────────────────────────────────────────────────────────
  "nav.home": "হোম",
  "nav.posts": "পোস্ট",
  "nav.tags": "ট্যাগ",
  "nav.series": "সিরিজ",
  "nav.videos": "ভিডিও",
  "nav.pictures": "ছবি",
  "nav.authors": "লেখক",
  "nav.chat": "চ্যাট",
  "nav.contact": "যোগাযোগ",
  "nav.privacy": "গোপনীয়তা",

  // ── Header ────────────────────────────────────────────────────────────
  "header.search": "খুঁজুন",
  "header.login": "প্রবেশ করুন",
  "header.profile": "প্রোফাইল",
  "header.menuOpen": "মেনু খুলুন",
  "header.menuClose": "মেনু বন্ধ করুন",
  "header.lightMode": "সাদা মোডে যান",
  "header.darkMode": "কালো মোডে যান",
  "header.homeAria": "হোম",
  "header.notifications": "নোটিফিকেশন",

  // ── Bottom nav ────────────────────────────────────────────────────────
  "bottomNav.home": "হোম",
  "bottomNav.tags": "ট্যাগ",
  "bottomNav.search": "খুঁজুন",
  "bottomNav.notifications": "নোটিফিকেশন",
  "bottomNav.profile": "প্রোফাইল",
  "bottomNav.login": "প্রবেশ করুন",

  // ── Footer ────────────────────────────────────────────────────────────
  "footer.rights": "সর্বস্বত্ব সংরক্ষিত",
  "footer.followUs": "আমাদের ফলো করুন",
  "footer.language": "ভাষা",
  "footer.allRightsReserved": "সর্বস্বত্ব সংরক্ষিত।",

  // ── Language switcher ─────────────────────────────────────────────────
  "switcher.label": "English-এ পরিবর্তন করুন",
  "switcher.toEnglish": "English-এ পরিবর্তন করুন",
  "switcher.toBangla": "বাংলায় পরিবর্তন করুন",

  // ── Pagination ────────────────────────────────────────────────────────
  "pagination.previousPage": "পূর্ববর্তী পৃষ্ঠা",
  "pagination.nextPage": "পরবর্তী পৃষ্ঠা",
  "pagination.previous": "পূর্ববর্তী",
  "pagination.next": "পরবর্তী",
  "pagination.pageOf": "পৃষ্ঠা {n} / {m}",
  "pagination.page": "পৃষ্ঠা {n}",

  // ── Home ──────────────────────────────────────────────────────────────
  "home.videosAndStories": "ভিডিও ও গল্প",
  "home.videos": "ভিডিও",
  "home.pictures": "ছবি",
  "home.stories": "গল্প",
  "home.featuredStories": "নির্বাচিত গল্প",
  "home.thisWeekBest": "এই সপ্তাহের সেরা পড়াগুলো",
  "home.allFeatured": "সব নির্বাচিত",
  "home.latestStories": "সর্বশেষ গল্প",
  "home.latestCount": "মোট {count}টি গল্পের মধ্য থেকে",
  "home.noStoriesTitle": "কোনো লেখা পাওয়া যায়নি",
  "home.noStoriesBody": "এই মুহূর্তে কোনো গল্প প্রকাশিত হয়নি।",
  "home.browseAll": "সব দেখুন",
  "home.seoHeading": "বাংলা চটি গল্প ও ভিডিও",
  "home.seoBody1":
    "এখানে বাংলায় সব রকমের চটি গল্প আছে। পড়ুন আর মনকে উত্তেজিত করুন।",
  "home.seoBody2":
    "প্রতিদিন নতুন নতুন বাংলা চটি গল্প প্রকাশিত হয় — পড়ার জন্য প্রস্তুত থাকুন।",
  "home.disclaimer":
    "এই সাইটের সব গল্প কল্পনার ভিত্তিতে লেখা। এখানে প্রকাশিত সব লেখা সম্পূর্ণ কাল্পনিক।",

  // ── Story detail ──────────────────────────────────────────────────────
  "story.notFound": "গল্পটি পাওয়া যায়নি",
  "story.pendingTitle": "অপেক্ষমাণ গল্প (Pending Approval)",
  "story.pendingBody":
    "এই গল্পটি এখনো অ্যাডমিন কর্তৃক অনুমোদিত ও প্রকাশিত হয়নি। শুধুমাত্র লেখক হিসেবে আপনি এবং অ্যাডমিনরা এটি দেখতে পাচ্ছেন।",
  "story.author": "লেখক",
  "story.viewProfile": "প্রোফাইল",
  "story.readingTime": "পড়ার সময়",
  "story.relatedStories": "সম্পর্কিত গল্প",
  "story.tags": "ট্যাগ",
  "story.share": "শেয়ার করুন",
  "story.previous": "পূর্ববর্তী গল্প",
  "story.next": "পরবর্তী গল্প",
  "story.copyLink": "লিংক কপি করুন",
  "story.copied": "কপি হয়েছে",

  // ── About ─────────────────────────────────────────────────────────────
  "about.title": "সম্পর্কে",
  "about.intro":
    "বাংলা চটি কাহিনী — বাংলায় সব রকমের চটি গল্প, পানু কাহিনী ও সেক্স স্টোরির সংগ্রহ।",
  "about.authorsHeading": "লেখকবৃন্দ",
  "about.website": "ওয়েবসাইট",
  "about.contact": "যোগাযোগ",
  "about.heading": "পরিচিতি",

  // ── Posts ─────────────────────────────────────────────────────────────
  "posts.title": "পোস্ট — বাংলা চটি কাহিনী",
  "posts.heading": "সব পোস্ট",
  "posts.subheading": "সম্প্রদায়ের সব পোস্ট এক জায়গায়",
  "posts.empty": "এখনো কোনো পোস্ট নেই",

  // ── Tags ──────────────────────────────────────────────────────────────
  "tags.title": "ট্যাগ — বাংলা চটি কাহিনী",
  "tags.heading": "সব ট্যাগ",
  "tags.subheading": "বিভিন্ন বিষয়ের গল্প খুঁজে নিন",
  "tags.browseAll": "সব ট্যাগ দেখুন",
  "tags.empty": "কোনো ট্যাগ পাওয়া যায়নি",

  // ── Categories ────────────────────────────────────────────────────────
  "categories.title": "ক্যাটাগরি — বাংলা চটি কাহিনী",
  "categories.heading": "সব ক্যাটাগরি",
  "categories.empty": "কোনো গল্প পাওয়া যায়নি",

  // ── Search ────────────────────────────────────────────────────────────
  "search.title": "খুঁজুন — বাংলা চটি কাহিনী",
  "search.heading": "গল্প খুঁজুন",
  "search.placeholder": "গল্প, লেখক বা ট্যাগ লিখুন…",
  "search.button": "খুঁজুন",
  "search.empty": "কোনো ফলাফল পাওয়া যায়নি",
  "search.error": "খোঁজা করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।",
  "search.resultsCount": "{count}টি ফলাফল",
  "search.clear": "মুছে ফেলুন",
  "search.filters": "ফিল্টার",
  "search.advancedFilters": "অ্যাডভান্সড ফিল্টার",
  "search.clearFilters": "সব ফিল্টার মুছুন",
  "search.category": "ক্যাটাগরি",
  "search.allCategories": "সব ক্যাটাগরি",
  "search.tag": "ট্যাগ",
  "search.tagPlaceholder": "যেমন: রোমান্স, থ্রিলার",
  "search.author": "লেখক",
  "search.authorPlaceholder": "লেখকের নাম বা ইউজারনেম",
  "search.searching": "খোঁজা হচ্ছে...",

  // ── Sidebar ───────────────────────────────────────────────────────────
  "sidebar.trending": "জনপ্রিয় গল্প",
  "sidebar.categories": "ক্যাটাগরি",
  "sidebar.tags": "ট্যাগ",
  "sidebar.archive": "আর্কাইভ",
  "sidebar.author": "লেখক",
  "sidebar.aboutAuthor": "লেখক পরিচিতি",
  "sidebar.moreStories": "আরও গল্প",
  "sidebar.relatedPosts": "সম্পর্কিত পোস্ট",

  // ── Post card ─────────────────────────────────────────────────────────
  "post.readMore": "আরও পড়ুন",
  "post.readingTime": "পড়ার সময়",
  "post.by": "লেখক",

  // ── Profile ───────────────────────────────────────────────────────────
  "profile.title": "প্রোফাইল — বাংলা চটি কাহিনী",
  "profile.myPosts": "আমার পোস্ট",
  "profile.saved": "সংরক্ষিত",
  "profile.likes": "পছন্দ",
  "profile.history": "ইতিহাস",
  "profile.settings": "সেটিংস",
  "profile.noPosts": "কোনো পোস্ট নেই",
  "profile.loginRequired": "এটি দেখতে লগইন করুন",

  // ── Contact ───────────────────────────────────────────────────────────
  "contact.title": "যোগাযোগ — বাংলা চটি কাহিনী",
  "contact.heading": "যোগাযোগ করুন",
  "contact.name": "আপনার নাম",
  "contact.email": "ইমেইল",
  "contact.subject": "বিষয়",
  "contact.message": "বার্তা",
  "contact.send": "পাঠান",
  "contact.sending": "পাঠানো হচ্ছে…",
  "contact.success": "আপনার বার্তা পাঠানো হয়েছে।",
  "contact.error": "বার্তা পাঠানো যায়নি। আবার চেষ্টা করুন।",

  // ── Common ────────────────────────────────────────────────────────────
  "common.loading": "লোড হচ্ছে…",
  "common.error": "কিছু একটা সমস্যা হয়েছে",
  "common.retry": "আবার চেষ্টা করুন",
  "common.backHome": "হোমে ফিরে যান",
  "common.readMore": "আরও পড়ুন",
  "common.notFoundTitle": "পৃষ্ঠাটি পাওয়া যায়নি",
  "common.notFoundBody":
    "আপনি যে পৃষ্ঠাটি খুঁজছেন সেটি সরানো হয়েছে বা কখনও ছিল না।",
  "common.more": "আরও",
  "common.viewAll": "সব দেখুন",
};
