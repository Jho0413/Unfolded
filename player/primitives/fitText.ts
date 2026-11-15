// Fitting a value into a fixed box without a layout pass (QA A3): a matrix cell is 64 x 48
// at a 26 px font, so a long value ("0.9817", "BMW truck carrot") ran into its neighbours.
// The font shrinks to fit, words wrap onto up to three lines when that lets it be bigger,
// and below the smallest legible size the text is squeezed to the width (textLength), so it
// never leaves its box. Widths are estimated, erring wide for the board's serif.

/** Average glyph width, in ems (errs wide). */
export const FIT_CHAR_EM = 0.58;
/** Line height, in ems, when a value wraps. */
export const FIT_LINE_EM = 1.1;
const MAX_LINES = 3;

export interface FittedText {
  lines: string[];
  fontSize: number;
  /** True when even `minFont` is too wide: draw it with textLength = the box width. */
  squeeze: boolean;
}

const width = (s: string) => [...s].length;

/** The words split into `k` lines, keeping the longest line as short as possible. */
function balance(words: readonly string[], k: number): string[] {
  let best: string[] = [words.join(" ")];
  let bestLen = Infinity;
  const go = (from: number, left: number, acc: string[]) => {
    if (left === 1) {
      const lines = [...acc, words.slice(from).join(" ")];
      const len = Math.max(...lines.map(width));
      if (len < bestLen) [best, bestLen] = [lines, len];
      return;
    }
    for (let i = from + 1; i <= words.length - left + 1; i++)
      go(i, left - 1, [...acc, words.slice(from, i).join(" ")]);
  };
  go(0, k, []);
  return best;
}

/**
 * The biggest font (at most `maxFont`) at which `text` fits a `w` x `h` box, on one line or
 * wrapped at spaces onto up to three; `squeeze` when it fits only below `minFont`.
 */
export function fitText(
  text: string,
  box: { w: number; h: number },
  font: { max: number; min: number },
): FittedText {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const options =
    words.length > 12 // too many to try every split: one line, squeezed if it must be
      ? [[text]]
      : Array.from(
          { length: Math.min(MAX_LINES, Math.max(1, words.length)) },
          (_, i) => (i === 0 ? [text] : balance(words, i + 1)),
        );
  let best: FittedText = { lines: [text], fontSize: 0, squeeze: false };
  for (const lines of options) {
    const longest = Math.max(1, ...lines.map(width));
    const size = Math.min(
      font.max,
      box.w / (longest * FIT_CHAR_EM),
      box.h / (lines.length * FIT_LINE_EM),
    );
    if (size > best.fontSize) best = { lines, fontSize: size, squeeze: false };
  }
  if (best.fontSize >= font.min) return best;
  // Too long for any legible size: one line at minFont, or the fewest lines whose height
  // still fits, squeezed to the width.
  const lines = options.findLast(
    (l) => l.length * FIT_LINE_EM * font.min <= box.h,
  ) ?? [text];
  return { lines, fontSize: font.min, squeeze: true };
}
