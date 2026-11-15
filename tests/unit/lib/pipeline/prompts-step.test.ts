// lib/pipeline/prompts/step.ts (ARCHITECTURE.md section 5.1): what a step prompt receives.
import { describe, expect, it } from "vitest";
import { config } from "@/lib/config";
import { validateWireStep } from "@/lib/pipeline/outputFormat";
import {
  PAPER_REFS_PROMPT,
  paperContextPrompt,
} from "@/lib/pipeline/prompts/paper";
import {
  retryPrompt,
  STEP_SYSTEM_PROMPT,
  stepContextPrompt,
  VIZ_EXAMPLES,
} from "@/lib/pipeline/prompts/step";
import type { LessonPlanOutput } from "@/shared/lesson";
import { MAX_PAPER_QUOTE_CHARS, VIZ_LIMITS } from "@/shared/scene";

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

  it("a paper with text (#98): gives its page count and asks for quotes", () => {
    const text = stepContextPrompt({
      plan: PLAN,
      n: 1,
      signals: [],
      paperPageCount: 15,
    });
    expect(text).toContain(paperContextPrompt(15));
    expect(text).toContain("The paper has 15 pages");
  });

  it("no paper to quote (#98): says paperRefs is empty", () => {
    const text = stepContextPrompt({ plan: PLAN, n: 1, signals: [] });
    expect(text).toContain(paperContextPrompt(undefined));
    expect(text).toContain("paperRefs is empty");
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

  it("has the paper section (#98): verbatim quotes up to the contract's cap, on the PDF's 1-based page, optionally cued", () => {
    expect(STEP_SYSTEM_PROMPT).toContain(PAPER_REFS_PROMPT);
    expect(PAPER_REFS_PROMPT).toContain(
      `at most ${MAX_PAPER_QUOTE_CHARS} characters`,
    );
    expect(PAPER_REFS_PROMPT).toContain("counting the PDF's first page as 1");
    expect(PAPER_REFS_PROMPT).toContain("cue: optional");
  });

  it("offers heatmaps and plots in objectsJson, with the contract's limits (#103)", () => {
    expect(STEP_SYSTEM_PROMPT).toContain("# Heatmaps and plots");
    expect(STEP_SYSTEM_PROMPT).toContain(
      'objectsJson is a string holding a JSON array of them, or "[]"',
    );
    for (const limit of [
      `1 to ${VIZ_LIMITS.maxHeatmapDim} rows`,
      `at most ${VIZ_LIMITS.maxPoints}`,
      `at least ${VIZ_LIMITS.minSize}`,
    ])
      expect(STEP_SYSTEM_PROMPT).toContain(limit);
  });

  it("shows each example's objectsJson as the JSON string Claude writes, and its actions", () => {
    for (const example of Object.values(VIZ_EXAMPLES)) {
      expect(STEP_SYSTEM_PROMPT).toContain(
        `objectsJson: ${JSON.stringify(JSON.stringify(example.objects))}`,
      );
      for (const action of example.actions)
        expect(STEP_SYSTEM_PROMPT).toContain(
          `action: ${JSON.stringify(action)}`,
        );
    }
  });
});

describe("VIZ_EXAMPLES", () => {
  it("each example is a valid wire step with a narration that has its cues", () => {
    for (const example of Object.values(VIZ_EXAMPLES)) {
      const cues = [...new Set(example.actions.map((a) => a.cue))];
      const result = validateWireStep(
        {
          title: "An example",
          narration: cues.map((c) => `Look [[${c}]]here.`).join(" "),
          objects: [],
          objectsJson: JSON.stringify(example.objects),
          actions: example.actions,
        },
        { maxNarrationChars: config.maxNarrationChars },
      );
      expect(result).toMatchObject({ ok: true });
    }
  });
});

describe("retryPrompt", () => {
  it("lists every error", () => {
    const text = retryPrompt(['unknown cue "x"', "narration too long"]);
    expect(text).toContain('- unknown cue "x"\n- narration too long');
  });
});
