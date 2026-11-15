// player/paper/selection.ts: asking about a passage selected in the paper (issue #129).
import { describe, expect, it } from "vitest";
import {
  askAboutNote,
  askAboutPrefill,
  MIN_SELECTION_CHARS,
  PREFILL_QUOTE_CHARS,
  selectionQuote,
} from "@/player/paper/selection";
import { MAX_PAPER_QUOTE_CHARS } from "@/shared/scene";

describe("selectionQuote", () => {
  it("collapses the text layer's line breaks and spacing", () => {
    expect(
      selectionQuote("  Pair their entries\nand multiply   each pair. "),
    ).toBe("Pair their entries and multiply each pair.");
  });

  it("joins a word hyphenated across a line break", () => {
    expect(
      selectionQuote(
        "The products of the paired entries are add-\ned together",
      ),
    ).toBe("The products of the paired entries are added together");
  });

  it("keeps a real hyphen within a line", () => {
    expect(selectionQuote("a row-by-column sum")).toBe("a row-by-column sum");
  });

  it("is null for a selection too short to ask about", () => {
    expect(selectionQuote("")).toBeNull();
    expect(selectionQuote(" \n ")).toBeNull();
    expect(selectionQuote("x".repeat(MIN_SELECTION_CHARS - 1))).toBeNull();
    expect(selectionQuote("x".repeat(MIN_SELECTION_CHARS))).not.toBeNull();
  });

  it("caps a long selection at MAX_PAPER_QUOTE_CHARS, cut at a word", () => {
    const quote = selectionQuote("softmax ".repeat(100))!;
    expect(quote.length).toBeLessThanOrEqual(MAX_PAPER_QUOTE_CHARS);
    expect(quote).toMatch(/softmax…$/);
  });
});

describe("askAboutPrefill", () => {
  it("quotes the passage with its page, ready for the question", () => {
    expect(askAboutPrefill({ quote: "every output cell", page: 2 })).toBe(
      'About "every output cell" (p.2): ',
    );
  });

  it("shortens a long quote in the box", () => {
    const quote = "word ".repeat(60).trim();
    const prefill = askAboutPrefill({ quote, page: 4 });
    const shown = prefill.slice('About "'.length, prefill.indexOf('" (p.4)'));
    expect(shown.length).toBeLessThanOrEqual(PREFILL_QUOTE_CHARS);
    expect(shown).toMatch(/word…$/);
  });
});

describe("askAboutNote", () => {
  it("tells the agent the whole passage and its page", () => {
    const quote = "word ".repeat(60).trim();
    const note = askAboutNote({ quote, page: 4 });
    expect(note).toContain("in the document (page 4)");
    expect(note).toContain(`"${quote}"`);
  });
});
