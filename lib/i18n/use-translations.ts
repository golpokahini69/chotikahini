"use client";

import { useLocale } from "@/components/providers/LocaleProvider";
import { t } from "./messages";
import type { MessageKey, ParamsFor } from "./keys";

/**
 * Client-side translation hook.
 *
 * The locale comes from `LocaleProvider`, whose value is rendered by a
 * Server Component — so the first client render always matches the server
 * HTML. No `window` sniffing, no hydration mismatch.
 */
export function useTranslations() {
  const locale = useLocale();
  return <K extends MessageKey>(key: K, params?: ParamsFor<K>) =>
    t(locale, key, params);
}
