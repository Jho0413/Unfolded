// Maths written into plain text is repaired, not rejected (#90, shared/plainMaths.ts).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { repairPlainMaths, repairSketchPlainMaths } from "@/shared/plainMaths";
import type { Sketch } from "@/shared/scene";

/** A narrated answer's narration (#105): its one cue, "c", fires on the first word. */
const SAID = "[[c]]Here it is.";

describe("repairPlainMaths: input table", () => {
  it.each([
    ["no scripts: unchanged", "Why scale the scores?", "Why scale the scores?"],
    ["empty: unchanged", "", ""],
    ["a subscript letter", "d_k", "dₖ"],
    ["a subscript digit", "x_1 + x_2", "x₁ + x₂"],
    ["a superscript digit", "x^2", "x²"],
    ["a transpose", "QK^T", "QKᵀ"],
    ["a braced script", "e^{x}", "eˣ"],
    ["a braced script with no Unicode form", "W_{QK}", "W QK"],
    ["a capital subscript (none in Unicode)", "W_Q", "W Q"],
    ["inside words", "big d_k means big scores", "big dₖ means big scores"],
    ["a trailing mark", "score_", "score"],
    ["a mark before a space", "x ^ 2", "x 2"],
    ["Unicode around it", "√d_k ≈ 8", "√dₖ ≈ 8"],
  ])("%s: %j → %j", (_name, input, expected) => {
    expect(repairPlainMaths(input)).toBe(expected);
  });
});

describe("repairPlainMaths: properties", () => {
  it("never leaves an underscore or a caret", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(repairPlainMaths(s)).not.toMatch(/[_^]/);
      }),
    );
  });

  it("leaves text without scripts exactly as it was", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !/[_^]/.test(s)),
        (s) => {
          expect(repairPlainMaths(s)).toBe(s);
        },
      ),
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = repairPlainMaths(s);
        expect(repairPlainMaths(once)).toBe(once);
      }),
    );
  });
});

describe("repairSketchPlainMaths", () => {
  const sketch: Sketch = {
    narration: SAID,
    objects: [
      { kind: "text", id: "t", x: 800, y: 110, text: "d_k grows" },
      {
        kind: "matrix",
        id: "m",
        x: 400,
        y: 300,
        rows: [["x_1", "x^2"]],
        label: "W_Q",
      },
      {
        kind: "arrow",
        id: "a",
        from: { id: "t" },
        to: { id: "m" },
        label: "÷ √d_k",
      },
      { kind: "latex", id: "f", x: 800, y: 500, tex: "\\sqrt{d_k}" },
    ],
    actions: [
      {
        do: "write",
        target: { id: "m", row: 0, col: 0 },
        value: "q^T k",
        cue: "c",
        durationMs: 400,
      },
    ],
  };
  const repaired = repairSketchPlainMaths(sketch);

  it("repairs texts, matrix cells and labels, arrow labels and written values", () => {
    const [t, m, a] = repaired.objects;
    expect(t).toMatchObject({ text: "dₖ grows" });
    expect(m).toMatchObject({ rows: [["x₁", "x²"]], label: "W Q" });
    expect(a).toMatchObject({ label: "÷ √dₖ" });
    expect(repaired.actions[0]).toMatchObject({ value: "qᵀ k" });
  });

  it("leaves latex objects alone: there the maths is wanted", () => {
    expect(repaired.objects[3]).toEqual(sketch.objects[3]);
  });
});
