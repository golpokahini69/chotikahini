/**
 * Canonical form of a video's URL, used to detect duplicates.
 *
 * The same clip reaches the admin form in many different-looking shapes:
 *
 *   https://youtu.be/dQw4w9WgXcQ
 *   https://www.youtube.com/watch?v=dQw4w9WgXcQ
 *   https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0
 *   https://www.youtube.com/embed/dQw4w9WgXcQ/
 *   https://WWW.YouTube.com/watch?v=dQw4w9WgXcQ&t=30
 *
 * All five are the same video. Comparing the raw strings would let an admin
 * publish the same clip repeatedly — each copy creating another card on
 * /videos and counting its own views.
 *
 * So a URL is reduced to a stable key before it is compared:
 *
 *   <provider>:<video-id>          a provider we recognise
 *                                  e.g. `youtube:dQw4w9WgXcQ`
 *
 *   url:<host>/<path>[?<query>]    a provider we DON'T recognise
 *                                  e.g. `url:example.com/e/abc`
 *
 * The provider's video ID is the video's identity — it is the same token in
 * the watch shape and the embed shape, which is exactly what makes the
 * duplicate check work. `lib/embed-resolver.ts` already models that mapping
 * per provider (see its PROVIDER_RULES); the host lists below mirror it.
 *
 * ── Keeping the two tables in sync ──────────────────────────────────────
 * This file carries its own provider list rather than importing
 * `lib/embed-resolver.ts`, because this module must stay dependency-free
 * (no `@/` alias imports) so it can be compiled and exercised standalone.
 * If you add a provider to `lib/embed-resolver.ts`, add it here too.
 *
 * ── Why the fallback keeps the query string ──────────────────────────────
 * For an unrecognised host we cannot know where the video ID lives — for
 * Redtube it is `?id=…`, for Pornhub it is `?viewkey=…`. Dropping the query
 * would collapse every video on such a host into one key, which is worse
 * than the occasional false negative. So the fallback keeps it.
 *
 * ── Case rules ──────────────────────────────────────────────────────────
 * IDs are kept verbatim except for Dailymotion, whose IDs are lower-cased
 * (the provider itself treats them case-insensitively). YouTube, Xvideos and
 * XNXX IDs ARE case-sensitive, so those are never folded.
 */

/** One provider: the hosts it answers on, and how to pull its video ID out. */
interface ProviderRule {
  /** Stable name used in the key (`youtube:…`). */
  keyName: string;
  /** Hostnames (without `www.`) this provider answers on. */
  hosts: string[];
  /**
   * Patterns matched against the URL PATH, each capturing the video ID in
   * group 1. Tried before `queryPatterns`.
   */
  pathPatterns: RegExp[];
  /**
   * Patterns matched against the URL QUERY STRING, each capturing the video
   * ID in group 1. Only used when no path pattern matched.
   */
  queryPatterns?: RegExp[];
  /**
   * How many capture groups make up the video ID. Defaults to 1.
   *
   * Tube8 needs 2 — its identity is the pair `<account>/<clip>`, so two
   * different clips on the same account are two different videos.
   */
  idGroups?: number;
}

/**
 * The provider table.
 *
 * The path patterns cover BOTH the embed shape (`/embed/<id>`) and the watch
 * shape (`/watch?v=<id>`) — a video is the same whichever the admin pasted,
 * so both must reduce to the same key.
 */
const PROVIDER_RULES: ProviderRule[] = [
  {
    keyName: "youtube",
    hosts: [
      "youtube.com",
      "youtube-nocookie.com",
      "youtu.be",
      "m.youtube.com",
    ],
    pathPatterns: [
      /^\/(?:embed|v|shorts|live|e)\/([A-Za-z0-9_-]{6,})(?:\/|$)/,
      // youtu.be/<id> — a bare video id as the whole path.
      /^\/([A-Za-z0-9_-]{6,})\/?$/,
    ],
    queryPatterns: [/(?:^|&)v=([A-Za-z0-9_-]{6,})(?:&|$)/],
  },
  {
    keyName: "vimeo",
    hosts: ["vimeo.com", "player.vimeo.com"],
    pathPatterns: [
      /^\/(?:video\/)?(\d{6,})(?:\/|$)/,
    ],
  },
  {
    keyName: "dailymotion",
    hosts: ["dailymotion.com", "dai.ly"],
    pathPatterns: [
      /^\/(?:embed\/video\/|video\/)?([A-Za-z0-9]{5,})(?:\/|$)/,
    ],
  },
  {
    keyName: "xvideos",
    hosts: ["xvideos.com", "xvideos.link"],
    pathPatterns: [
      /^\/embedframe\/([A-Za-z0-9]{6,})(?:\/|$)/,
      /^\/video[.-]([A-Za-z0-9]{6,})(?:\/|$)/,
    ],
  },
  {
    keyName: "xnxx",
    hosts: ["xnxx.com"],
    pathPatterns: [
      /^\/embedframe\/([A-Za-z0-9]{6,})(?:\/|$)/,
      /^\/video[.-]([A-Za-z0-9]{6,})(?:\/|$)/,
    ],
  },
  {
    keyName: "xhamster",
    hosts: ["xhamster.com", "xhamster.desi", "xhamster2.com", "xhamster3.com"],
    pathPatterns: [
      /^\/embed\/([A-Za-z0-9_-]{6,})(?:\/|$)/,
      /^\/videos\/([A-Za-z0-9_-]{6,})(?:\/|$)/,
    ],
  },
  {
    keyName: "pornhub",
    hosts: ["pornhub.com"],
    pathPatterns: [
      /^\/embed\/([A-Za-z0-9]{6,})(?:\/|$)/,
    ],
    queryPatterns: [/(?:^|&)viewkey=([A-Za-z0-9]{6,})(?:&|$)/],
  },
  {
    keyName: "spankbang",
    hosts: ["spankbang.com"],
    pathPatterns: [
      // /<account>/embed/ — the account IS the identity for this provider.
      /^\/([^/]+)\/embed\/?$/,
      // /<account>/video/<slug>
      /^\/([^/]+)\/video\/[^/]+(?:\/|$)/,
    ],
  },
  {
    keyName: "faphouse",
    hosts: ["faphouse.com", "faphouse2.com"],
    pathPatterns: [
      /^\/embed\/([A-Za-z0-9_-]{6,})(?:\/|$)/,
      /^\/videos\/([A-Za-z0-9_-]{6,})(?:\/|$)/,
    ],
  },
  {
    keyName: "redtube",
    hosts: ["redtube.com"],
    pathPatterns: [
      // /embed/?id=12345 — the ID is in the query, the path is bare.
      /^\/embed\/?$/,
      // /videos/12345 (watch page) and /12345.
      /^\/(?:videos\/)?(\d{3,})(?:\/|$)/,
    ],
    queryPatterns: [/(?:^|&)id=(\d{3,})(?:&|$)/],
  },
  {
    keyName: "youporn",
    hosts: ["youporn.com"],
    pathPatterns: [
      /^\/embed\/(\d{3,})(?:\/|$)/,
      /^\/watch\/(\d{3,})(?:\/|$)/,
    ],
  },
  {
    keyName: "tube8",
    hosts: ["tube8.com"],
    pathPatterns: [
      /^\/embed\/([^/]+)\/([^/]+)(?:\/|$)/,
      /^\/([^/]+)\/([^/]+)(?:\/|$)/,
    ],
    // The identity is the account AND the clip — `acctA/clip1` and
    // `acctA/clip2` are two different videos.
    idGroups: 2,
  },
  {
    keyName: "beeg",
    hosts: ["beeg.com"],
    pathPatterns: [
      /^\/embed\/(\d{4,})(?:\/|$)/,
      /^\/(\d{4,})(?:\/|$)/,
    ],
  },
];

/**
 * Canonical key for a video URL.
 *
 * Returns an empty string for anything that isn't a usable absolute URL, so
 * the caller can skip the check rather than treat a malformed URL as a
 * duplicate of everything.
 */
export function videoSourceKey(url: string): string {
  const raw = (url || "").trim();
  if (!raw) return "";

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

  for (const rule of PROVIDER_RULES) {
    if (!rule.hosts.includes(host)) continue;

    const id = extractProviderId(rule, parsed);
    if (!id) break;

    // Dailymotion IDs are case-insensitive on the provider's side, so they
    // are folded. Every other provider's ID is case-sensitive and is kept
    // verbatim.
    const normalized = rule.keyName === "dailymotion" ? id.toLowerCase() : id;
    return `${rule.keyName}:${normalized}`;
  }

  return fallbackUrlKey(raw);
}

/**
 * Pull the video ID out of a URL for a known provider.
 *
 * Path patterns are tried first, then query patterns — a provider that puts
 * its ID in the path (`/embed/<id>`) must not be shadowed by a query pattern
 * that happens to match a tracking parameter.
 */
function extractProviderId(rule: ProviderRule, url: URL): string | null {
  const path = url.pathname;
  const groups = rule.idGroups ?? 1;

  for (const pattern of rule.pathPatterns) {
    const id = joinCaptureGroups(path.match(pattern), groups);
    if (id) return id;
  }

  if (rule.queryPatterns) {
    const query = url.search.replace(/^\?/, "");
    for (const pattern of rule.queryPatterns) {
      const id = joinCaptureGroups(query.match(pattern), groups);
      if (id) return id;
    }
  }

  return null;
}

/**
 * Join the first N capture groups of a match into one ID.
 *
 * A provider whose identity spans two path segments (Tube8's
 * `<account>/<clip>`) needs both, joined with `/` — the same separator the
 * URL uses, so the key stays readable and unambiguous.
 */
function joinCaptureGroups(
  match: RegExpMatchArray | null,
  groups: number,
): string | null {
  if (!match) return null;

  const parts: string[] = [];
  for (let i = 1; i <= groups; i++) {
    const part = match[i];
    if (!part) return null;
    parts.push(part);
  }

  return parts.join("/");
}

/**
 * Canonical key for a host we don't recognise.
 *
 * The URL is reduced by ordered string surgery (rather than by reading
 * `URL.pathname` / `URL.search`) so the result depends only on the literal
 * text the admin pasted — the `URL` parser percent-encodes some characters
 * differently from the raw string, and we want a stable answer either way.
 *
 * The steps mirror lib/picture-source-url.ts, except the query string is
 * KEPT (see the file header).
 */
function fallbackUrlKey(raw: string): string {
  // Drop the scheme.
  let rest = raw;
  const schemeEnd = rest.indexOf("://");
  if (schemeEnd !== -1) rest = rest.slice(schemeEnd + 3);

  // Drop the fragment, then split off the query.
  const hash = rest.indexOf("#");
  if (hash !== -1) rest = rest.slice(0, hash);

  let query = "";
  const question = rest.indexOf("?");
  if (question !== -1) {
    query = rest.slice(question + 1);
    rest = rest.slice(0, question);
  }

  // Split the host from the path.
  const slash = rest.indexOf("/");
  let host = slash === -1 ? rest : rest.slice(0, slash);
  let path = slash === -1 ? "" : rest.slice(slash + 1);

  // Lower-case the host FIRST, then drop a leading "www." — so
  // "WWW.example.com" is handled the same as "www.example.com".
  host = host.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);

  // Drop the trailing slash from the path.
  path = path.replace(/\/+$/, "");

  if (!host) return "";

  const base = path ? `${host}/${path}` : host;
  return query ? `url:${base}?${query}` : `url:${base}`;
}

/**
 * Two URLs point at the same video?
 *
 * Falls back to an exact string comparison when either side cannot be
 * parsed, so a malformed URL is never treated as a duplicate of everything
 * else — it just won't match anything.
 */
export function isSameVideoSource(a: string, b: string): boolean {
  const keyA = videoSourceKey(a);
  const keyB = videoSourceKey(b);
  if (!keyA || !keyB) return (a || "").trim() === (b || "").trim();
  return keyA === keyB;
}
