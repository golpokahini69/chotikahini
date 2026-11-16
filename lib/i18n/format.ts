import type { Locale } from "./locale";

/**
 * Locale-aware date, number and relative-time formatting.
 *
 * The Bangla behaviour here matches the existing helpers in `lib/utils.ts`
 * exactly, so switching a call site over to these functions does not change
 * a single rendered character on the Bangla site.
 */

const TIMEZONE = "Asia/Dhaka";
const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

/** The Intl locale tag used for each of our two locales. */
export const INTL_LOCALE: Record<Locale, string> = {
  bn: "bn-BD",
  en: "en-US",
};

function toIntlLocale(locale: Locale | string): string {
  return locale in INTL_LOCALE
    ? INTL_LOCALE[locale as Locale]
    : locale;
}

/** Parse the year/month/day out of an Asia/Dhaka-offset timestamp string. */
function dhakaDateParts(dateStr: string) {
  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(5, 7), 10);
  const day = parseInt(dateStr.slice(8, 10), 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  return { year, month, day };
}

/** Format a stored date string, locked to Bangladesh Time. */
export function formatDate(
  dateStr: string,
  locale: Locale = "bn",
): string {
  if (!dateStr) return "";
  const intl = toIntlLocale(locale);
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat(intl, {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(d);
  } catch {
    const parts = dhakaDateParts(dateStr);
    if (!parts) return dateStr;
    const { year, month, day } = parts;
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString(intl, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
}

/** Format a stored date string with date & time, locked to Bangladesh Time. */
export function formatDateTime(
  dateStr: string,
  locale: Locale = "bn",
): string {
  if (!dateStr) return "";
  const intl = toIntlLocale(locale);
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat(intl, {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
  } catch {
    return formatDate(dateStr, locale);
  }
}

/**
 * Format a number for display.
 *
 * Bangla renders Bengali digits (১২৩); English leaves ASCII digits alone.
 */
export function formatNumber(
  num: string | number,
  locale: Locale = "bn",
): string {
  const text = num.toString();
  if (locale === "en") return text;
  return text.replace(/[0-9]/g, (digit) => BN_DIGITS[parseInt(digit, 10)]);
}

/**
 * Human-readable relative time.
 *
 * The Bangla branch reuses the exact wording of `timeAgoBn` in
 * `lib/utils.ts` so existing Bangla pages are unchanged. The English branch
 * uses `Intl.RelativeTimeFormat`, which handles singular/plural and the
 * "yesterday"-style edge cases for us.
 */
export function timeAgo(input: unknown, locale: Locale = "bn"): string {
  const raw =
    input instanceof Date ? input.getTime() : Date.parse(String(input ?? ""));
  if (!Number.isFinite(raw)) return "";

  const diffMs = Date.now() - raw;

  if (locale === "en") {
    const seconds = Math.floor(Math.abs(diffMs) / 1000);
    if (seconds < 60) return "just now";
    try {
      const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return rtf.format(-minutes, "minute");
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return rtf.format(-hours, "hour");
      const days = Math.floor(hours / 24);
      if (days < 7) return rtf.format(-days, "day");
      const weeks = Math.floor(days / 7);
      if (weeks < 5) return rtf.format(-weeks, "week");
      const months = Math.floor(days / 30);
      if (months < 12) return rtf.format(-months, "month");
      return rtf.format(-Math.floor(days / 365), "year");
    } catch {
      const days = Math.floor(diffMs / 86400000);
      return `${days} day${days === 1 ? "" : "s"} ago`;
    }
  }

  // ── Bangla: identical wording to `timeAgoBn` ──────────────────────────
  if (diffMs < 0) return "এইমাত্র";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "এইমাত্র";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${formatNumber(min, "bn")} মিনিট আগে`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${formatNumber(hr, "bn")} ঘণ্টা আগে`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${formatNumber(day, "bn")} দিন আগে`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${formatNumber(wk, "bn")} সপ্তাহ আগে`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${formatNumber(mo, "bn")} মাস আগে`;
  return `${formatNumber(Math.floor(day / 365), "bn")} বছর আগে`;
}
