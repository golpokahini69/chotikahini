// ─────────────────────────────────────────────────────────────
// lib/client-visitor-id.ts — one stable, anonymous id per browser.
//
// Shared by every view counter (story, video, picture).
//
// Why a client id and not the IP: view de-duplication used to key on
// `ip|user-agent|day`, which quietly fails in two common cases —
//
//   • the visitor is behind a proxy/VPN that hides their real IP, so the
//     server sees a shared address and counts almost nobody; and
//   • the same person on two devices/languages looks like two people.
//
// A local id survives both. It is per-browser, never sent anywhere except
// as a short opaque string inside a view ping, and reset if the visitor
// clears site data.
// ─────────────────────────────────────────────────────────────

const STORAGE_KEY = "site_visitor_id";

/**
 * Cached so every component on the page agrees on ONE id.
 *
 * Without this, the storage-blocked path below would mint a fresh id on
 * each call — three counters on a story page would then be three different
 * "visitors" and the view would be counted three times.
 */
let sessionId: string | null = null;

function mint(): string {
  return `vis_${Math.random().toString(36).slice(2, 11)}${Date.now().toString(36)}`;
}

export function getVisitorId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) {
      sessionId = existing;
      return existing;
    }

    const created = sessionId ?? mint();
    localStorage.setItem(STORAGE_KEY, created);
    sessionId = created;
    return created;
  } catch {
    // Private mode / blocked storage: reuse the same id for this page
    // session, and the server falls back to ip|ua if we send nothing.
    sessionId ??= mint();
    return sessionId;
  }
}
