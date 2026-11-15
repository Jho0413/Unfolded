// shared/paperText.ts: the one normaliser the server's quote check and the browser's
// highlighter share (issue #98), so a quote the server accepts is always found.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { findQuote, paperKey } from "@/shared/paperText";
import { HighlightPaperParams } from "@/shared/tools";

/** The page text a span covers. */
function covered(page: string, quote: string): string | null {
  const span = findQuote(page, quote);
  return span === null ? null : page.slice(span.start, span.end);
}

describe("paperKey", () => {
  it("drops whitespace, hyphens and dashes, lower-cases, and folds ligatures and quotes", () => {
    expect(paperKey("Self-  Attention\n—“ﬁne” ‘ﬂow’").key).toBe(
      "selfattention\"fine\"'flow'",
    );
  });

  it("maps every key character back to the code point it came from", () => {
    const text = "a ﬁ­b";
    const { key, at } = paperKey(text);
    expect(key).toBe("afib");
    expect(at).toEqual([0, 2, 2, 4]);
  });

  it("folds math alphanumerics to letters (NFKC)", () => {
    expect(paperKey("𝑥𝑦").key).toBe("xy");
  });

  it("keeps astral code points whole", () => {
    const { key, at } = paperKey("x 😀y");
    expect(key).toBe("x😀y");
    expect(at).toEqual([0, 2, 2, 4]);
  });
});

describe("findQuote", () => {
  const page =
    "We propose a new simple network architecture, the Trans-\nformer, based solely on atten-\ntion mechanisms, dispensing with recurrence and convolutions entirely.";

  it("finds an exact quote, the span covering just its characters", () => {
    expect(covered(page, "a new simple network")).toBe("a new simple network");
  });

  it("ignores differences in whitespace and line breaks", () => {
    expect(
      covered("dispensing   with\n\trecurrence", "dispensing with recurrence"),
    ).toBe("dispensing   with\n\trecurrence");
  });

  it("joins words hyphenated across lines", () => {
    expect(
      covered(page, "the Transformer, based solely on attention mechanisms"),
    ).toBe("the Trans-\nformer, based solely on atten-\ntion mechanisms");
  });

  it("matches a compound broken at its own hyphen, and words the extractor ran together", () => {
    expect(
      covered("multi-\nhead self-attention", "multi-head selfattention"),
    ).toBe("multi-\nhead self-attention");
    expect(covered("scaleddot-product", "scaled dot-product")).toBe(
      "scaleddot-product",
    );
  });

  it("matches ligature glyphs in the PDF against plain letters, and back", () => {
    expect(covered("an eﬃcient ﬁt", "an efficient fit")).toBe("an eﬃcient ﬁt");
    expect(covered("an efficient fit", "an eﬃcient ﬁt")).toBe(
      "an efficient fit",
    );
  });

  it("ignores case and curly versus straight quotes", () => {
    expect(covered("the “Attention” layer", 'THE "attention" LAYER')).toBe(
      "the “Attention” layer",
    );
  });

  it("returns null for a quote that isn't on the page", () => {
    expect(findQuote(page, "recurrent neural networks")).toBeNull();
  });

  it("returns null for a quote with nothing left once normalised", () => {
    expect(findQuote(page, " - \n ")).toBeNull();
  });

  it("returns the first occurrence", () => {
    expect(findQuote("ab ab", "ab")).toEqual({ start: 0, end: 2 });
  });

  it("property: any slice of a page is found, and the span's text has the slice's key", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 60 }),
        fc.nat(),
        fc.nat(),
        (text, a, b) => {
          const start = a % text.length;
          const end = start + 1 + (b % (text.length - start));
          const quote = text.slice(start, end);
          const span = findQuote(text, quote);
          if (paperKey(quote).key === "") return span === null;
          return (
            span !== null &&
            paperKey(text.slice(span.start, span.end)).key ===
              paperKey(quote).key
          );
        },
      ),
    );
  });
});

describe("HighlightPaperParams", () => {
  it("takes a quote and an optional 1-based page", () => {
    expect(HighlightPaperParams.safeParse({ quote: "q" }).success).toBe(true);
    expect(
      HighlightPaperParams.safeParse({ quote: "q", page: 3 }).success,
    ).toBe(true);
    expect(HighlightPaperParams.safeParse({ quote: "" }).success).toBe(false);
    expect(
      HighlightPaperParams.safeParse({ quote: "q", page: 0 }).success,
    ).toBe(false);
  });
});
