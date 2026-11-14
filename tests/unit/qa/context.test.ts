// The Q&A context message builder (ARCHITECTURE.md section 8, ROADMAP Q3).
import { describe, expect, it } from "vitest";
import {
  buildContextUpdate,
  narrationUpTo,
  type QaContext,
} from "@/qa/context";

const base: QaContext = {
  planTitles: ["Matrices", "Row times column", "Attention"],
  step: 1,
  narrationSoFar: "Take the first row",
  boardIds: ["q", "k", "out"],
  earlierQuestions: [],
};

describe("buildContextUpdate", () => {
  it("lists the plan titles, 1-based, and marks the current step", () => {
    const text = buildContextUpdate(base);
    expect(text).toContain(
      "1. Matrices\n2. Row times column (current step)\n3. Attention",
    );
  });

  it("sends the narration so far", () => {
    expect(buildContextUpdate(base)).toContain(
      'Narration of step 2 so far: "Take the first row"',
    );
    expect(buildContextUpdate({ ...base, narrationSoFar: "  " })).toContain(
      "so far: (nothing yet)",
    );
  });

  it("sends the step's goal while the step is loading", () => {
    const text = buildContextUpdate({
      ...base,
      narrationSoFar: null,
      stepGoal: "Each output cell is a row times a column",
    });
    expect(text).toContain(
      "Step 2 is still loading. Its goal: Each output cell is a row times a column",
    );
    expect(text).not.toContain("Narration");
  });

  it("sends the board ids, or says the board is empty", () => {
    expect(buildContextUpdate(base)).toContain(
      "Objects on the board (ids for highlight): q, k, out",
    );
    expect(buildContextUpdate({ ...base, boardIds: [] })).toContain(
      "The board is empty.",
    );
  });

  it("sends the earlier questions, oldest first, only when there are some", () => {
    expect(buildContextUpdate(base)).not.toContain("Questions asked");
    const text = buildContextUpdate({
      ...base,
      earlierQuestions: ["What is a row?", "Why multiply?"],
    });
    expect(text).toContain(
      "Questions asked earlier in this lesson:\n- What is a row?\n- Why multiply?",
    );
  });
});

describe("narrationUpTo", () => {
  const narration = "Take the first [[row1]]row and the [[col1]]column.";
  const cues = { row1: 1000, col1: 2500 };

  it("cuts before the first cue timed after t, markers stripped", () => {
    expect(narrationUpTo(narration, cues, 0)).toBe("Take the first ");
    expect(narrationUpTo(narration, cues, 1000)).toBe(
      "Take the first row and the ",
    );
    expect(narrationUpTo(narration, cues, Infinity)).toBe(
      "Take the first row and the column.",
    );
  });

  it("doesn't cut at cues without a time, or named after prototype keys", () => {
    expect(narrationUpTo("A [[constructor]]b [[x]]c", { x: 5 }, 0)).toBe(
      "A b ",
    );
  });
});
