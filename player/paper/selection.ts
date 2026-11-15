// Ask about a passage selected in the paper (issue #129, ARCHITECTURE.md section 5.6). Pure:
// the paper viewer reads the learner's selection, the lesson page highlights it briefly, and
// the Ask panel prefills its box and tells the agent which passage the question is about.
import { MAX_PAPER_QUOTE_CHARS } from "@/shared/scene";

/** A passage the learner selected: its text and its page (1-based). */
export type PaperSelection = { quote: string; page: number };

/** Shorter selections (a stray click or a letter) offer no chip. */
export const MIN_SELECTION_CHARS = 3;
/** How long the passage asked about stays highlighted in the paper. */
export const ASK_ABOUT_HIGHLIGHT_MS = 2500;
/** The box shows this much of the quote at most; the agent gets the whole (capped) quote. */
export const PREFILL_QUOTE_CHARS = 120;

/**
 * The selection's text as a quote: a word hyphenated across a line break joined again
 * ("add-\ned" -> "added"), whitespace collapsed, at most MAX_PAPER_QUOTE_CHARS (cut at a word).
 * Null when too short to ask about.
 */
export function selectionQuote(text: string): string | null {
  const quote = text
    .replace(/(\w)-\s*\n\s*(\w)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  if (quote.length < MIN_SELECTION_CHARS) return null;
  return clip(quote, MAX_PAPER_QUOTE_CHARS);
}

/** The Ask box's prefill: `About "…" (p.N): `, the learner's question to follow. */
export function askAboutPrefill({ quote, page }: PaperSelection): string {
  return `About "${clip(quote, PREFILL_QUOTE_CHARS)}" (p.${page}): `;
}

/** The agent's contextual update: the passage the learner's next question is about. */
export function askAboutNote({ quote, page }: PaperSelection): string {
  return `The learner selected this passage in the document (page ${page}) and is asking about it: "${quote}". Their next question is about this passage.`;
}

/** At most `max` characters, cut at a word with "…" if it was longer. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
