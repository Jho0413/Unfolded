// lib/pipeline/prompts/step.ts (ARCHITECTURE.md section 5.1): what a step prompt receives.
import { describe, expect, it } from "vitest";
import { config } from "@/lib/config";
import {
  retryPrompt,
  STEP_SYSTEM_PROMPT,
  stepContextPrompt,
} from "@/lib/pipeline/prompts/step";
import type { LessonPlanOutput } from "@/shared/lesson";

const PLAN: LessonPlanOutput = {
  title: "A lesson",
  coverPrompt: "a cover",
  steps: [
    { title: "One", goal: "Goal one." },
    { title: "Two", goal: "Goal two." },
    { title: "Three", goal: "Goal three." },
  ],
};

describe("stepContextPrompt", () => {
  it("has the whole plan and marks this step, with its goal", () => {
    const text = stepContextPrompt({ plan: PLAN, n: 1, signals: [] });
    expect(text).toContain("A lesson");
    for (const s of PLAN.steps) expect(text).toContain(`${s.title}: ${s.goal}`);
    expect(text).toContain("2. Two: Goal two.  <- this step");
    expect(text).toContain('Write step 2 of 3: "Two".\nGoal: Goal two.');
  });

  it("step 0 says it's the first step", () => {
    const text = stepContextPrompt({ plan: PLAN, n: 0, signals: [] });
    expect(text).toContain("This is the first step");
  });

  it("the previous step's narration, if generated, with its markers stripped", () => {
    const text = stepContextPrompt({
      plan: PLAN,
      n: 2,
      previousNarration: "Take the [[r]]row and [[c]]column.",
      signals: [],
    });
    expect(text).toContain("Take the row and column.");
    expect(text).not.toContain("[[");
  });

  it("after a jump (previous step not generated), the previous step's goal", () => {
    const text = stepContextPrompt({ plan: PLAN, n: 2, signals: [] });
    expect(text).toContain("hasn't been written yet");
    expect(text).toContain("Its goal was: Goal two.");
  });

  it("the learner's questions and simplify requests, but not started signals", () => {
    const text = stepContextPrompt({
      plan: PLAN,
      n: 1,
      signals: [
        { question: "Why the square root?" },
        { simplify: "too fast" },
        { started: 0, version: 1 },
      ],
    });
    expect(text).toContain("- Asked: Why the square root?");
    expect(text).toContain("- Asked to simplify: too fast");
    expect(text).not.toContain("started");
  });

  it("no learner section when there are no questions or simplify requests", () => {
    const text = stepContextPrompt({
      plan: PLAN,
      n: 1,
      signals: [{ started: 0, version: 1 }],
    });
    expect(text).not.toContain("learner_messages");
  });
});

describe("STEP_SYSTEM_PROMPT", () => {
  it("doesn't offer image objects (the board draws none until E1)", () => {
    expect(STEP_SYSTEM_PROMPT).not.toMatch(/^- image:/m);
    expect(STEP_SYSTEM_PROMPT).toContain("there are no images");
  });

  it("asks for maths spelled out in the narration (TTS reads symbols badly, S1)", () => {
    expect(STEP_SYSTEM_PROMPT).toContain("spell all maths out in words");
  });

  it("states the narration cap from lib/config.ts", () => {
    expect(STEP_SYSTEM_PROMPT).toContain(`${config.maxNarrationChars}`);
  });
});

describe("retryPrompt", () => {
  it("lists every error", () => {
    const text = retryPrompt(['unknown cue "x"', "narration too long"]);
    expect(text).toContain('- unknown cue "x"\n- narration too long');
  });
});
