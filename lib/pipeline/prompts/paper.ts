// What the step prompt says about pointing at the paper (issue #98): verbatim quotes the paper
// viewer beside the board highlights while the narration talks about them. The system part is
// built from constants only, so the step prompt that embeds it stays byte-identical.
import "server-only";
import { MAX_PAPER_QUOTE_CHARS } from "@/shared/scene";

/** The "# The document" section of the step system prompt. */
export const PAPER_REFS_PROMPT = `# The document

The learner sees the document beside the whiteboard. When the request gives the document's page count, point at the passages this step talks about: paperRefs lists 1 to 3 of them, in narration order.

- quote: copied from the document word for word, at most ${MAX_PAPER_QUOTE_CHARS} characters. Pick one sentence (or part of one), a figure's or table's caption, or a section heading, and copy it exactly as printed: never paraphrase, shorten with "...", or join text from two places. Don't quote an equation's symbols, which don't copy reliably; quote the sentence that introduces it instead.
- page: the PDF page it is on, counting the PDF's first page as 1 (not the number printed on the page).
- label: optional, what the passage is, e.g. "Eq. 1", "Section 3.2" or "Chapter 2".
- cue: optional, a marker name from the narration, on the word where you start talking about the passage; it is highlighted from then. Without a cue, it is highlighted from the step's start. A marker can cue both actions and a passage.

When the request doesn't give a page count, paperRefs is empty.`;

/** The request's line about the document: its page count, or that there is nothing to quote. */
export function paperContextPrompt(pageCount: number | undefined): string {
  return pageCount === undefined
    ? "This lesson can't show the document: paperRefs is empty."
    : `The document has ${pageCount} pages: quote it in paperRefs.`;
}
