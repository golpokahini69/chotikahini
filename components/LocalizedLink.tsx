"use client";

import Link from "next/link";
import { useLocale } from "./providers/LocaleProvider";
import { localizeHref } from "@/lib/i18n/links";

/**
 * A `next/link` that automatically prefixes internal page links with the
 * active locale.
 *
 * Server Components can't use hooks, so they should call `localizeHref`
 * directly and use a plain `next/link`. This wrapper is for the client
 * components.
 */
export function LocalizedLink({
  href,
  children,
  ...rest
}: React.ComponentProps<typeof Link>) {
  const locale = useLocale();
  const resolved = typeof href === "string" ? localizeHref(href, locale) : href;
  return (
    <Link href={resolved} {...rest}>
      {children}
    </Link>
  );
}
