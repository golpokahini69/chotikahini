import type { Locale } from "./locale";
import type { MessageKey, ParamsFor } from "./keys";
import { bn } from "./bn";
import { en } from "./en";

const catalogs: Record<Locale, Record<MessageKey, string>> = { bn, en };

export function getMessages(locale: Locale): Record<MessageKey, string> {
  return catalogs[locale] ?? catalogs.bn;
}

/**
 * Replace `{name}` placeholders with the supplied values.
 *
 * A placeholder with no matching parameter is left intact rather than
 * rendered as "undefined" — the missing value is then obvious on screen
 * instead of silently producing garbage copy.
 */
export function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/**
 * Look up a message in the requested locale.
 *
 * Fallback chain: requested locale → Bangla → the key itself. The UI is
 * never blank, even if a catalogue is incomplete.
 */
export function t<K extends MessageKey>(
  locale: Locale,
  key: K,
  params?: ParamsFor<K>,
): string {
  const catalog = catalogs[locale] ?? catalogs.bn;
  const template = catalog[key] ?? catalogs.bn[key] ?? key;
  return interpolate(
    template,
    params as Record<string, string | number> | undefined,
  );
}
