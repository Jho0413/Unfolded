// Finding a quote in the paper (issue #98, ARCHITECTURE.md section 5.6). Pure: the viewer
// passes each page's text items (pdf.js text content, one per text-layer span) and gets back
// the page and the item ranges to highlight.
//
// 1. Exact, with the shared normaliser (shared/paperText.ts findQuote): the given page
//    first, then the others, nearest first. A step's quotes are checked on the server with
//    the same function, so they're always found here.
// 2. Fuzzy, for the agent's quotes from memory: the closest stretch of a page's key within
//    FUZZY_MAX_ERROR_RATE edits (Sellers' approximate matching), ties going to the given page.
import { findQuote, paperKey, type QuoteSpan } from "@/shared/paperText";

/** A text item of a page: what one text-layer span shows. */
export type PaperItem = { str: string };

/** Characters `start`..`end` (exclusive) of item `item` on the page. */
export type ItemRange = { item: number; start: number; end: number };

export type PaperMatch = {
  /** 1-based. */
  page: number;
  ranges: ItemRange[];
  exact: boolean;
};

/** Shorter quotes (in key characters) are only matched exactly: too easy to find by chance. */
export const FUZZY_MIN_CHARS = 12;
/** Edits allowed per key character of the quote. */
export const FUZZY_MAX_ERROR_RATE = 0.2;

export function locateQuote(
  pages: readonly (readonly PaperItem[])[],
  quote: string,
  page?: number,
): PaperMatch | null {
  const order = pageOrder(pages.length, page);
  const texts = pages.map((items) => items.map((i) => i.str).join(""));
  for (const p of order) {
    const span = findQuote(texts[p], quote);
    if (span !== null)
      return { page: p + 1, ranges: itemRanges(pages[p], span), exact: true };
  }
  const needle = paperKey(quote).key;
  if (needle.length < FUZZY_MIN_CHARS) return null;
  const maxErrors = Math.floor(needle.length * FUZZY_MAX_ERROR_RATE);
  let best: { p: number; span: QuoteSpan; errors: number } | null = null;
  for (const p of order) {
    const hay = paperKey(texts[p]);
    const hit = approximate(hay.key, needle, maxErrors);
    if (hit === null || (best !== null && hit.errors >= best.errors)) continue;
    const last = hay.at[hit.end - 1];
    const span = {
      start: hay.at[hit.start],
      end: last + codePointLength(texts[p], last),
    };
    best = { p, span, errors: hit.errors };
    if (hit.errors === 0) break;
  }
  return best === null
    ? null
    : {
        page: best.p + 1,
        ranges: itemRanges(pages[best.p], best.span),
        exact: false,
      };
}

/** Page indices: the given 1-based page first, then the others by distance from it. */
function pageOrder(count: number, page: number | undefined): number[] {
  const first = page !== undefined && page >= 1 && page <= count ? page - 1 : 0;
  return Array.from({ length: count }, (_, i) => i).sort(
    (a, b) => Math.abs(a - first) - Math.abs(b - first) || a - b,
  );
}

/** A span of the joined page text, as ranges of the items it covers (empty items skipped). */
export function itemRanges(
  items: readonly PaperItem[],
  span: QuoteSpan,
): ItemRange[] {
  const out: ItemRange[] = [];
  let offset = 0;
  items.forEach((item, i) => {
    const from = Math.max(span.start, offset);
    const to = Math.min(span.end, offset + item.str.length);
    if (from < to)
      out.push({ item: i, start: from - offset, end: to - offset });
    offset += item.str.length;
  });
  return out;
}

function codePointLength(text: string, index: number): number {
  return (text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
}

/**
 * The stretch of `text` closest to `pattern` in edit distance, if within `maxErrors`: the
 * first end with the fewest edits, then the latest start that reaches it with as few (the
 * shortest such stretch). `end` exclusive.
 */
export function approximate(
  text: string,
  pattern: string,
  maxErrors: number,
): { start: number; end: number; errors: number } | null {
  const end = bestEnd(text, pattern);
  if (end === null || end.errors > maxErrors) return null;
  const reversedText = [...text.slice(0, end.at)].reverse().join("");
  const reversedPattern = [...pattern].reverse().join("");
  const back = bestEnd(reversedText, reversedPattern, true);
  if (back === null) return null;
  return { start: end.at - back.at, end: end.at, errors: end.errors };
}

/**
 * Sellers: the end (exclusive) of the substring of `text` nearest `pattern`, and its distance.
 * `anchored`: only substrings that start at 0 (plain edit distance against each prefix).
 */
function bestEnd(
  text: string,
  pattern: string,
  anchored = false,
): { at: number; errors: number } | null {
  const m = pattern.length;
  if (m === 0 || text.length === 0) return null;
  let col = Array.from({ length: m + 1 }, (_, i) => i);
  let next = new Array<number>(m + 1);
  let best: { at: number; errors: number } | null = null;
  for (let j = 1; j <= text.length; j++) {
    next[0] = anchored ? j : 0;
    const c = text[j - 1];
    for (let i = 1; i <= m; i++) {
      const cost = pattern[i - 1] === c ? 0 : 1;
      next[i] = Math.min(col[i - 1] + cost, col[i] + 1, next[i - 1] + 1);
    }
    [col, next] = [next, col];
    if (best === null || col[m] < best.errors) best = { at: j, errors: col[m] };
  }
  return best;
}
