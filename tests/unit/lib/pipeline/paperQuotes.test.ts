// lib/pipeline/paperQuotes.ts checkPaperQuotes (issue #98, ARCHITECTURE.md section 4): a step's
// paper quotes checked against the page text. One test per row of its table; the generator's
// retry around it is tested in step.test.ts.
import { describe, expect, it } from "vitest";
import { checkPaperQuotes, quoteErrors } from "@/lib/pipeline/paperQuotes";
import type { CuedPaperRef, Step } from "@/shared/scene";
import type { ValidationResult } from "@/shared/validate";

const PAGES = [
  "Title page. We show how to multiply two matrices.",
  "1 MethodPair their entries and multiply each pair. The products of the pairedentries are add-ed together.",
];
const FOUND: CuedPaperRef = {
  page: 2,
  quote: "The products of the paired entries are added together",
  label: "Section 1",
  cue: "go",
};
const ALSO_FOUND: CuedPaperRef = { page: 1, quote: "multiply two matrices" };
const MISSING: CuedPaperRef = {
  page: 2,
  quote: "A sentence the paper never says",
};
const WRONG_PAGE: CuedPaperRef = { page: 1, quote: "Pair their entries" };

const step = (paperRefs?: CuedPaperRef[]): Step => ({
  title: "A step",
  narration: "Watch [[go]]this.",
  objects: [],
  actions: [],
  ...(paperRefs && { paperRefs }),
});
const ok = (value: Step): ValidationResult<Step> => ({ ok: true, value });

describe("checkPaperQuotes: one test per row", () => {
  it("all quotes found (case, line breaks and a hyphenated break aside): the step as it is", () => {
    const valid = ok(step([ALSO_FOUND, FOUND]));
    expect(checkPaperQuotes(valid, PAGES)).toBe(valid);
  });

  it("some missing: rejected naming each missing quote and its page, softOnly keeps the found ones", () => {
    expect(checkPaperQuotes(ok(step([FOUND, MISSING])), PAGES)).toEqual({
      ok: false,
      errors: [quoteErrors.notOnPage(1, 2, MISSING.quote)],
      softOnly: { value: step([FOUND]), count: 1 },
    });
  });

  it("all missing: softOnly is the step with no paperRefs at all", () => {
    const result = checkPaperQuotes(ok(step([MISSING])), PAGES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.softOnly?.value).toEqual(step());
      expect(result.softOnly?.value).not.toHaveProperty("paperRefs");
    }
  });

  it("quote on the wrong page: treated as missing, and the error says where it is", () => {
    const result = checkPaperQuotes(ok(step([WRONG_PAGE])), PAGES);
    expect(result).toEqual({
      ok: false,
      errors: [quoteErrors.notOnPage(0, 1, WRONG_PAGE.quote, 2)],
      softOnly: { value: step(), count: 1 },
    });
    if (!result.ok) expect(result.errors[0]).toContain("(it is on page 2)");
  });

  it("a page past the paper's last: treated as missing", () => {
    const result = checkPaperQuotes(ok(step([{ ...FOUND, page: 3 }])), PAGES);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toEqual([
        quoteErrors.notOnPage(0, 3, FOUND.quote, 2),
      ]);
  });

  it("no paper text (no paper.pdf, or unreadable): the step without paperRefs, with a warning to log", () => {
    expect(checkPaperQuotes(ok(step([FOUND])), undefined)).toEqual({
      ok: true,
      value: step(),
      warnings: [quoteErrors.noPaper(1)],
    });
  });

  it("no paper text and no paperRefs: the step as it is, nothing to log", () => {
    const valid = ok(step());
    expect(checkPaperQuotes(valid, undefined)).toBe(valid);
  });

  it("a step already rejected (a cue not in the narration, ...): returned unchanged, for the retry", () => {
    const rejected: ValidationResult<Step> = {
      ok: false,
      errors: ['unknown cue "nowhere"'],
    };
    expect(checkPaperQuotes(rejected, PAGES)).toBe(rejected);
  });
});
