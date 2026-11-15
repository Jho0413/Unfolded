// player/paper/locate.ts: finding a quote in the paper's text items (issue #98).
import { describe, expect, it } from "vitest";
import {
  approximate,
  itemRanges,
  locateQuote,
  type PaperItem,
  type PaperMatch,
} from "@/player/paper/locate";

const items = (...strs: string[]): PaperItem[] => strs.map((str) => ({ str }));

/** The highlighted text of a match, item by item. */
function shown(pages: PaperItem[][], match: PaperMatch | null): string[] {
  if (match === null) return [];
  return match.ranges.map((r) =>
    pages[match.page - 1][r.item].str.slice(r.start, r.end),
  );
}

const pages = [
  items("Attention Is All You Need", "Abstract"),
  items(
    "We propose a new simple network architecture, the Trans-",
    "former, based solely on atten-",
    "tion mechanisms, dispensing with recurrence.",
  ),
  items(
    "An attention function maps a query and a set of key-value pairs to an output.",
  ),
  items("ﬁne-tuning is eﬃcient", "Multi-Head Attention"),
];

describe("locateQuote", () => {
  it("whitespace: finds a quote however the text is spaced and split into items", () => {
    const m = locateQuote(pages, "a  new simple\nnetwork architecture");
    expect(m).toMatchObject({ page: 2, exact: true });
    expect(shown(pages, m)).toEqual(["a new simple network architecture"]);
  });

  it("hyphenation: a quote across items and line-end hyphens covers each item's part", () => {
    const m = locateQuote(
      pages,
      "the Transformer, based solely on attention mechanisms",
      2,
    );
    expect(shown(pages, m)).toEqual([
      "the Trans-",
      "former, based solely on atten-",
      "tion mechanisms",
    ]);
  });

  it("ligatures: plain letters match the PDF's ligature glyphs", () => {
    const m = locateQuote(pages, "fine-tuning is efficient");
    expect(m).toMatchObject({ page: 4, exact: true });
    expect(shown(pages, m)).toEqual(["ﬁne-tuning is eﬃcient"]);
  });

  it("not found: null", () => {
    expect(
      locateQuote(pages, "convolutional neural networks are great"),
    ).toBeNull();
    expect(locateQuote([], "anything")).toBeNull();
  });

  it("page preference: the given page wins when the quote is on several", () => {
    expect(locateQuote(pages, "attention", 3)?.page).toBe(3);
    expect(locateQuote(pages, "attention", 4)?.page).toBe(4);
    expect(locateQuote(pages, "attention")?.page).toBe(1);
  });

  it("page preference: a wrong or out-of-range page still finds the quote elsewhere", () => {
    expect(locateQuote(pages, "dispensing with recurrence", 4)?.page).toBe(2);
    expect(locateQuote(pages, "dispensing with recurrence", 99)?.page).toBe(2);
  });

  it("fuzzy: a quote from memory with a few words off still finds the passage", () => {
    const m = locateQuote(
      pages,
      "An attention function maps a query and a set of key value pairs to the output",
    );
    expect(m).toMatchObject({ page: 3, exact: false });
    expect(shown(pages, m)[0]).toMatch(
      /^An attention function maps .* to an output$/,
    );
  });

  it("fuzzy: too many differences, or a short quote, is not found", () => {
    expect(
      locateQuote(pages, "A recurrent network maps tokens to vectors"),
    ).toBeNull();
    expect(locateQuote(pages, "atention")).toBeNull();
  });
});

describe("itemRanges", () => {
  it("skips empty items and clips to the span", () => {
    expect(itemRanges(items("ab", "", "cd"), { start: 1, end: 3 })).toEqual([
      { item: 0, start: 1, end: 2 },
      { item: 2, start: 0, end: 1 },
    ]);
  });
});

describe("approximate", () => {
  it("finds the stretch nearest the pattern, start and end", () => {
    expect(approximate("xxhelloworldxx", "helloworld", 0)).toEqual({
      start: 2,
      end: 12,
      errors: 0,
    });
    expect(approximate("xxhelXoworldxx", "helloworld", 2)).toEqual({
      start: 2,
      end: 12,
      errors: 1,
    });
  });

  it("anchors the start to the match that ends there, not an earlier one", () => {
    expect(approximate("abcdefgh zzzz abcdefgX", "abcdefgh", 0)).toEqual({
      start: 0,
      end: 8,
      errors: 0,
    });
    expect(approximate("abcdefgX zzzz abcdefgh", "abcdefgh", 0)).toEqual({
      start: 14,
      end: 22,
      errors: 0,
    });
  });

  it("null when over the error budget", () => {
    expect(approximate("abcdef", "uvwxyz", 2)).toBeNull();
  });
});
