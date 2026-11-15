// lib/pipeline/generate.ts chooseAttempt: which of two attempts is used, one test per row of
// the ARCHITECTURE.md section 4 table (spacing is soft). The route tests drive it end to end.
import { describe, expect, it } from "vitest";
import { chooseAttempt } from "@/lib/pipeline/generate";
import type { ValidationResult } from "@/shared/validate";

const valid = (value: string): ValidationResult<string> => ({
  ok: true,
  value,
});
/** Only spacing problems, `count` of them: drawable. */
const spacing = (value: string, count = 1): ValidationResult<string> => ({
  ok: false,
  errors: Array.from({ length: count }, (_, i) => `too close ${value}${i}`),
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

  it("spacing only, then valid: the second", () => {
    expect(chooseAttempt(spacing("a"), valid("b"))).toEqual({
      value: "b",
      softErrors: [],
    });
  });

  it("spacing only twice: the one with fewer spacing problems, the second on a tie", () => {
    expect(chooseAttempt(spacing("a", 3), spacing("b", 1))).toMatchObject({
      value: "b",
    });
    expect(chooseAttempt(spacing("a", 1), spacing("b", 3))).toMatchObject({
      value: "a",
      softErrors: ["too close a0"],
    });
    expect(chooseAttempt(spacing("a", 2), spacing("b", 2))).toMatchObject({
      value: "b",
    });
  });

  it("hard, then spacing only: the second", () => {
    expect(chooseAttempt(hard("x"), spacing("b"))).toEqual({
      value: "b",
      softErrors: ["too close b0"],
    });
  });

  it("hard twice: fails with the second attempt's errors", () => {
    expect(chooseAttempt(hard("x"), hard("y"))).toEqual({ errors: ["y"] });
  });

  it("spacing only, then hard: the first", () => {
    expect(chooseAttempt(spacing("a"), hard("y"))).toEqual({
      value: "a",
      softErrors: ["too close a0"],
    });
  });
});
