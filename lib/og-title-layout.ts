// ── Shared OpenGraph title layout ─────────────────────────────
//
// Wrapping a title onto a share card is the same problem for every
// card we render — stories, videos, picture galleries — but the logic
// lived inside the story card route, where the media cards could not
// reach it. It lives here so there is exactly one implementation.
//
// The wrap is a small optimal-fit search: the title is split into
// chunks (words, or pieces of a word too long to fit on a line), then
// the fewest-lines-first arrangement whose lines are all within
// `maxWidth` and whose ragged right edge is as even as possible is
// chosen. "As even as possible" is the sum of the squared slack on
// each line — a full line and a nearly-empty line are worse than two
// half-full lines, which is what a reader sees as ragged text.

/**
 * Wrap `text` onto at most `maxLines` lines, each no wider than
 * `maxWidth` as measured by `measure`.
 *
 * A word that is wider than `maxWidth` on its own is split across
 * lines at character granularity, so a long unbroken string (a URL, a
 * Bengali compound with no spaces) is never silently dropped.
 *
 * @param text       The title to lay out.
 * @param measure    Returns the rendered width of a candidate line.
 * @param maxWidth   Maximum width of a line, in the same units as
 *                   `measure`.
 * @param maxLines   Maximum number of lines to use.
 * @returns The chosen lines, or `null` when the text cannot fit.
 */
export function wrapTitle(
  text: string,
  measure: (line: string) => number,
  maxWidth: number,
  maxLines: number,
): string[] | null {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const chunks = words.flatMap((word) => {
    if (measure(word) <= maxWidth) return [{ text: word, continuation: false }];
    const parts: string[] = [];
    let part = "";
    for (const character of Array.from(word)) {
      const candidate = part + character;
      if (part && measure(candidate) > maxWidth) {
        parts.push(part);
        part = character;
      } else {
        part = candidate;
      }
    }
    if (part) parts.push(part);
    return parts.map((text, index) => ({ text, continuation: index > 0 }));
  });
  const joinChunks = (start: number, end: number) =>
    chunks.slice(start, end).reduce(
      (line, chunk) => line + (line && !chunk.continuation ? " " : "") + chunk.text,
      "",
    );

  for (let lineCount = 1; lineCount <= Math.min(maxLines, chunks.length); lineCount += 1) {
    const memo = new Map<string, { cost: number; lines: string[] } | null>();
    const findLines = (
      start: number,
      linesLeft: number,
    ): { cost: number; lines: string[] } | null => {
      const key = `${start}:${linesLeft}`;
      if (memo.has(key)) return memo.get(key)!;
      if (linesLeft === 1) {
        const line = joinChunks(start, chunks.length);
        const width = measure(line);
        const result = width <= maxWidth
          ? { cost: (maxWidth - width) ** 2, lines: [line] }
          : null;
        memo.set(key, result);
        return result;
      }

      let best: { cost: number; lines: string[] } | null = null;
      for (let end = start + 1; end <= chunks.length - linesLeft + 1; end += 1) {
        const line = joinChunks(start, end);
        const width = measure(line);
        if (width > maxWidth) break;
        const rest = findLines(end, linesLeft - 1);
        if (!rest) continue;
        const candidate = {
          cost: (maxWidth - width) ** 2 + rest.cost,
          lines: [line, ...rest.lines],
        };
        if (!best || candidate.cost < best.cost) best = candidate;
      }
      memo.set(key, best);
      return best;
    };

    const result = findLines(0, lineCount);
    if (result) return result.lines;
  }
  return null;
}
