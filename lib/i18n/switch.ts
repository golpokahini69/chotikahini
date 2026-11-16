import type { Locale } from "./locale";
import { stripLocale } from "./links";

/**
 * Build the path that points at the same page in the other language.
 *
 * The current path is preserved so the reader lands on the equivalent page
 * rather than being bounced to the home page:
 *
 *   /about      → /en/about
 *   /en/about   → /about
 *   /           → /en
 *   /en         → /
 *   /page/2     → /en/page/2
 */
export function switchLocalePath(pathname: string, next: Locale): string {
  const bare = stripLocale(pathname || "/");
  if (next === "en") {
    return bare === "/" ? "/en" : `/en${bare}`;
  }
  return bare;
}
