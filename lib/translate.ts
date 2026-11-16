/**
 * lib/translate.ts
 *
 * Thin wrapper over the free Google Translate "GTX" endpoint.
 *
 * The endpoint has two entry points, and both callers here want the same
 * thing: the translated text for a chunk. `app/api/translate/route.ts` uses
 * it to turn English/Banglish into Bengali; `lib/public-slug.ts` uses it to
 * turn a Bengali title into English words for a URL slug.
 *
 * Keeping the request shape in one place means a change to the endpoint
 * (or to the response parsing) can't silently apply to one caller and not
 * the other.
 */

/** Google Translate target-language codes this project uses. */
export type TranslateTarget = "bn" | "en";

/**
 * Translate one chunk of text.
 *
 * Returns the input unchanged when the network call fails or the endpoint
 * answers with something unexpected. Callers that need to know whether the
 * translation actually happened should compare the result against the
 * input themselves — there is no separate "ok" flag, because a legitimate
 * translation can be identical to the source (a title that is already a
 * single English word, for instance).
 */
export async function translateText(
  text: string,
  target: TranslateTarget,
  source = "auto",
): Promise<string> {
  if (!text || !text.trim()) return text;

  try {
    // Ultra-fast Google Translate GTX endpoint.
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${source}&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
      next: { revalidate: 3600 },
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const translated = data[0].map((item: any) => item[0]).join("");
        if (translated) return translated;
      }
    }

    // Fallback: Google Translate M-web endpoint.
    const fallbackUrl = `https://translate.googleapis.com/translate_a/single?client=at&sl=${source}&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;
    const fbRes = await fetch(fallbackUrl);
    if (fbRes.ok) {
      const fbData = await fbRes.json();
      if (Array.isArray(fbData) && Array.isArray(fbData[0])) {
        return fbData[0].map((item: any) => item[0]).join("");
      }
    }
  } catch (err) {
    console.error("[translate] translation failed:", err);
  }

  return text;
}
