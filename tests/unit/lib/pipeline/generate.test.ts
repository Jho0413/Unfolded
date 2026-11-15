// lib/pipeline/generate.ts chooseAttempt: which of two attempts is used, one test per row of
// the ARCHITECTURE.md section 4 table (spacing is soft: overlaps are retried, tight spacing is
// only logged). The route tests (tests/unit/app/api/sketch-route.test.ts) drive it end to end,
// including that a valid first attempt makes no second call.
import { describe, expect, it } from "vitest";
import { chooseAttempt } from "@/lib/pipeline/generate";
import type { ValidationResult } from "@/shared/validate";

const valid = (value: string): ValidationResult<string> => ({
  ok: true,
  value,
});
/** Valid, with only tight spacing: warnings to log. */
const tight = (value: string): ValidationResult<string> => ({
  ok: true,
  value,
  warnings: [`too close ${value}`],
});
/** Only overlaps, `count` of them: drawable. */
const overlap = (value: string, count = 1): ValidationResult<string> => ({
  ok: false,
  errors: Array.from({ length: count }, (_, i) => `overlap ${value}${i}`),
  softOnly: { value, count },
});
/** A hard problem: not drawable. */
const hard = (error: string): ValidationResult<string> => ({
  ok: false,
  errors: [error],
});

describe("chooseAttempt", () => {
  it("valid first: the first (the second isn't needed)", () => {
    expect(chooseAttempt(valid("a"), hard("x"))).toEqual({
      value: "a",
      softErrors: [],
    });
  });

  it("tight spacing only, first: the first, its spacing logged as a warning", () => {
    expect(chooseAttempt(tight("a"), hard("x"))).toEqual({
      value: "a",
      softErrors: ["too close a"],
    });
  });

  it("overlap, then valid: the second", () => {
    expect(chooseAttempt(overlap("a"), valid("b"))).toEqual({
      value: "b",
      softErrors: [],
    });
  });

  it("overlap twice: the one with fewer overlaps, the second on a tie", () => {
    expect(chooseAttempt(overlap("a", 3), overlap("b", 1))).toMatchObject({
      value: "b",
    });
    expect(chooseAttempt(overlap("a", 1), overlap("b", 3))).toMatchObject({
      value: "a",
      softErrors: ["overlap a0"],
    });
    expect(chooseAttempt(overlap("a", 2), overlap("b", 2))).toMatchObject({
      value: "b",
    });
  });

  it("hard, then overlap only: the second", () => {
    expect(chooseAttempt(hard("x"), overlap("b"))).toEqual({
      value: "b",
      softErrors: ["overlap b0"],
    });
  });

  it("hard twice: fails with the second attempt's errors", () => {
    expect(chooseAttempt(hard("x"), hard("y"))).toEqual({ errors: ["y"] });
  });

  it("overlap, then hard: the first", () => {
    expect(chooseAttempt(overlap("a"), hard("y"))).toEqual({
      value: "a",
      softErrors: ["overlap a0"],
    });
  });
});
