// ── Social-metadata text sanitisation ───────────────────────────
//
// Social crawlers run a content classifier over the card *text* as well
// as the card image. An explicit term in `og:description` is enough for
// Facebook/X to suppress the whole card, even when the image is clean.
//
// This module produces a social-only variant of a string. It must NEVER
// touch the on-page copy:
//
//   - `<title>` and `<meta name="description">` keep the full editorial
//     text — they are what the site ranks for.
//   - `<meta name="keywords">` is untouched — gutting it would destroy
//     organic search performance on exactly the terms the site targets.
//   - JSON-LD `headline` / `description` / `keywords` are untouched.
//
// Only `og:*`, `twitter:*` and the text rendered inside the share-card
// image go through this.
//
// One deliberate exception: `চটি` / `choti` is the site's brand
// ("Chotikahini", "চটি কাহিনী"), and classifiers do not key on it —
// they key on the qualifiers around it. Rewriting the brand would strip
// the identity from every card without reducing classifier risk.

/**
 * A Unicode-aware word boundary.
 *
 * JavaScript's `\b` is ASCII-only: it matches between an ASCII word
 * character and a non-word character, so it never fires next to a Bengali
 * letter (Bengali code points are not `\w`). Every `\bসেক্স\b` pattern
 * therefore matched nothing and the Bengali half of this dictionary was
 * silently dead code.
 *
 * This builds the boundary from `\p{L}` / `\p{N}` lookarounds instead, so
 * it works identically for Latin and Bengali:
 *
 *   - `(?<![\p{L}\p{N}])` — not preceded by a letter or digit
 *   - `(?![\p{L}\p{N}])`  — not followed by a letter or digit
 *
 * The `u` flag is required for `\p{...}` to be recognised.
 */
const B = "(?<![\\p{L}\\p{N}\\p{M}])";
const E = "(?![\\p{L}\\p{N}\\p{M}])";

/**
 * The set of characters that can continue a word.
 *
 * Bengali vowel signs (`ি`, `ে`, `ো`, …) and other combining marks are
 * `\p{M}`, not `\p{L}` — they attach to the preceding consonant rather
 * than standing alone. They must be included on both sides of the
 * boundary, otherwise `চোদাচুদির` (where `ি` and `র` follow `দ`) does not
 * end at a boundary and the term fails to match.
 */
const WORD = "[\\p{L}\\p{N}\\p{M}]";

/**
 * Build a term pattern with Unicode-aware boundaries.
 *
 * `*` in the source marks a suffix wildcard, which matches any run of
 * word characters — including Bengali combining marks, so `গুদ*` consumes
 * the whole of `গুদের` rather than stopping at the vowel sign and
 * leaving an orphaned `ের` behind.
 *
 * @param source  The term, with `*` marking a suffix wildcard.
 */
function term(source: string): RegExp {
  const pattern = source
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(`${WORD}*`);
  return new RegExp(`${B}${pattern}${E}`, "giu");
}

/**
 * Fixed dictionary of explicit terms → neutral equivalents.
 *
 * Ordered longest-first within each language so that a compound term
 * (`সেক্স স্টোরি`) is rewritten before its component (`েক্স`).
 */
const SOCIAL_TERM_MAP: Array<[RegExp, string]> = [
  // Bengali — compounds first.
  [term("সেক্স স্টোরি"), "গল্প"],
  [term("সেক্স স্টোরি*"), "গল্প"],
  [term("সেক্স ভিডিও"), "ভিডিও"],
  [term("সেক্স ভিডিও*"), "ভিডিও"],
  [term("চোদাচুদি"), "গল্প"],
  // The inflected form (`চোদাচুদির`) is dropped rather than replaced —
  // replacing it with "গল্প" produced "গল্প গল্প" when the next word was
  // already "গল্প".
  [term("চোদাচুদি*"), ""],
  [term("চোদা*"), "গল্প"],
  [term("ভোদা*"), "গল্প"],
  [term("পানু"), "প্রেম"],
  [term("সেক্স"), "প্রেম"],
  [term("হট"), "নতুন"],
  [term("গুদ*"), ""],
  [term("চামচ*"), ""],
  [term("চুলা*"), ""],
  [term("খাওয়া*"), ""],

  // Latin — compounds first.
  //
  // The picture and video sections carry titles and descriptions that were
  // scraped verbatim from adult sites. Those are free English prose, not
  // the Bengali terms above, and the crawlers score them the same way, so
  // the explicit vocabulary they use is listed here too. Compounds come
  // first so the longer phrase is consumed before its component.
  [term("sex stories"), "stories"],
  [term("sex story*"), "stories"],
  [term("sex video*"), "video"],
  [term("sex scene*"), "scene"],
  [term("sex party*"), "party"],
  [term("bangla sex"), "bangla"],
  [term("hand job*"), "scene"],
  [term("handjob*"), "scene"],
  [term("blow job*"), "scene"],
  [term("blowjob*"), "scene"],
  [term("rim job*"), "scene"],
  [term("rimjob*"), "scene"],
  [term("tit job*"), "scene"],
  [term("titjob*"), "scene"],
  [term("creampie*"), "scene"],
  [term("cumshot*"), "scene"],
  [term("cum shot*"), "scene"],
  [term("face fuck*"), "scene"],
  [term("facefuck*"), "scene"],
  [term("deep throat*"), "scene"],
  [term("deepthroat*"), "scene"],
  [term("gang bang*"), "scene"],
  [term("gangbang*"), "scene"],
  [term("doggy style*"), "scene"],
  [term("doggystyle*"), "scene"],
  [term("masturbat*"), "scene"],
  [term("orgasm*"), "scene"],
  [term("ejaculat*"), "scene"],
  [term("erotic*"), "romantic"],
  [term("porn*"), ""],
  [term("nude*"), ""],
  [term("naked*"), ""],
  [term("sex"), "romance"],
  [term("fuck*"), ""],
  [term("licking*"), ""],
  [term("licked*"), ""],
  [term("cunt*"), ""],
  [term("pussy*"), ""],
  [term("dick*"), ""],
  [term("cock*"), ""],
  [term("boobs*"), ""],
  [term("tits*"), ""],
  [term("anal*"), ""],

  // Category and studio markers. These carry no sexual content of their
  // own, but they are the vocabulary the adult-video classifiers are
  // trained on, so a title that says "Teen", "Amateur" or "Nubile" reads
  // as explicit to the classifier even when the explicit nouns around it
  // have been rewritten.
  [term("nubile films*"), ""],
  [term("nubile"), ""],
  [term("teen"), ""],
  [term("teenager*"), ""],
  [term("amateur"), ""],
  [term("sexy"), ""],
  [term("blowjob scene"), "scene"],
  [term("hot"), "new"],
];

/**
 * Collapse a run of 3+ comma-separated short phrases into one generic
 * phrase.
 *
 * `seo.description` enumerates explicit scenarios ("মা ছেলে, বাবা মেয়ে,
 * …"). Even after the individual terms are replaced, the *enumeration
 * shape* itself reads as adult content to a classifier, so the list is
 * collapsed.
 */
const ENUMERATION_RE = /(?:[^,।]{2,40},\s*){3,}[^,।]{2,40}/g;

/**
 * Collapse an immediately repeated word.
 *
 * Several explicit terms all map to the same neutral replacement, so a
 * title like "Mutual Masturbation - Female Orgasm and Powerful Handjob
 * Cumshot" becomes "Mutual scene - Female scene and Powerful scene
 * scene". The repetition reads as broken, so it is collapsed.
 */
const REPEATED_WORD_RE = /\b(\S+)(?:\s+\1\b)+/gi;

/**
 * The same repetition, but with a conjunction between the two copies:
 * "scene and scene Compilation". The copy that is preceded by the
 * conjunction is the redundant one and is dropped.
 */
const REPEATED_WORD_JOINED_RE = /\b(\S+)\s+(and|or|ও|এবং)\s+\1\b/gi;

/**
 * Rewrite a string so it is safe to publish in `og:title`,
 * `og:description`, `twitter:title`, `twitter:description`, the
 * `og:image:alt`, and the text rendered inside the share-card image.
 */
export function sanitizeForSocial(text: string, maxLength?: number): string {
  if (!text) return "";

  let out = text;

  for (const [pattern, replacement] of SOCIAL_TERM_MAP) {
    out = out.replace(pattern, replacement);
  }

  out = out.replace(ENUMERATION_RE, "বিভিন্ন গল্প");
  out = out.replace(REPEATED_WORD_RE, "$1");
  out = out.replace(REPEATED_WORD_JOINED_RE, "$1");

  // Tidy up the punctuation left behind by the substitutions: doubled
  // separators, orphaned commas before the end of a phrase.
  out = out
    .replace(/\s*,\s*(?=,)/g, "")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,।])/g, "$1")
    .replace(/^[,\s]+/, "")
    .replace(/[,\s]+$/, "")
    .trim();

  if (maxLength && out.length > maxLength) {
    out = out.slice(0, maxLength).replace(/\s+\S*$/, "") + "…";
  }

  return out;
}

/**
 * Sanitize a *title* for social platforms.
 *
 * `sanitizeForSocial` deletes a term outright when its dictionary entry
 * maps to an empty string (`porn*` → `""`). In a description that is
 * harmless — the sentence simply loses a word. In a title it leaves a
 * hole: "Mutual Masturbation - Female Orgasm" became "Mutual - Female
 * scene", and "Teen Amateur Blowjob" became " Blowjob", which reads as
 * broken rather than as edited.
 *
 * This variant swaps the empty replacements for a neutral word, so the
 * headline keeps its shape and its rhythm. The result is still safe for
 * the classifiers — the point of the substitution is that the explicit
 * term is gone, not that the gap is visible.
 *
 * The filler is chosen per language: Bengali titles get "গল্প", Latin
 * ones get "scene".
 */
export function sanitizeTitleForSocial(text: string): string {
  if (!text) return "";

  // Bengali copy is filled with "গল্প", Latin copy with "scene" — the
  // filler has to match the surrounding language or it reads as a
  // machine translation.
  //
  // The language is judged on the *headline*, so this must be called
  // before the brand suffix is appended. The site's own name is
  // Bengali, so appending it first would make every headline look
  // Bengali — and an English title like "Nubile Films" came out as
  // "Nubile গল্প".
  const hasBengali = /[\u0980-\u09FF]/.test(text);
  const filler = hasBengali ? "গল্প" : "scene";

  const titleMap: Array<[RegExp, string]> = SOCIAL_TERM_MAP.map(
    ([pattern, replacement]) => [
      pattern,
      replacement === "" ? filler : replacement,
    ],
  );

  let out = text;
  for (const [pattern, replacement] of titleMap) {
    out = out.replace(pattern, replacement);
  }

  out = out.replace(ENUMERATION_RE, hasBengali ? "বিভিন্ন গল্প" : "various scenes");
  out = out.replace(REPEATED_WORD_RE, "$1");
  out = out.replace(REPEATED_WORD_JOINED_RE, "$1");

  return out
    .replace(/\s*,\s*(?=,)/g, "")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,।])/g, "$1")
    .replace(/^[,\s]+/, "")
    .replace(/[,\s]+$/, "")
    .trim();
}

/**
 * Sanitize a comma-separated keyword list and re-join it.
 *
 * Used for any keyword string that is exposed to social crawlers. The
 * site's own `<meta name="keywords">` is deliberately NOT routed here.
 */
export function sanitizeSocialKeywords(text: string): string {
  if (!text) return "";

  return text
    .split(",")
    .map((part) => sanitizeForSocial(part))
    .filter(Boolean)
    .join(", ");
}
