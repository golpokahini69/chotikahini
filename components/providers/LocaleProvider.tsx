"use client";

import { createContext, useContext } from "react";
import type { Locale } from "@/lib/i18n/locale";
import { DEFAULT_LOCALE } from "@/lib/i18n/locale";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/**
 * Exposes the active locale to client components.
 *
 * The value is supplied by a Server Component that knows the locale from
 * the route it rendered, so it is baked into the server HTML. That means the
 * first client render always agrees with the server output — no
 * `window.location` sniffing and no hydration mismatch.
 */
export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}

/** Read the active locale from client components. */
export function useLocale(): Locale {
  return useContext(LocaleContext);
}
