// lib/pipeline/prompts/step.ts (ARCHITECTURE.md section 5.1): what a step prompt receives.
import { describe, expect, it } from "vitest";
import { config } from "@/lib/config";
import { validateWireStep, WireImageObject } from "@/lib/pipeline/outputFormat";
import { MATRIX_CELL_MAX_CHARS } from "@/lib/pipeline/prompts/board";
import {
  PAPER_REFS_PROMPT,
  paperContextPrompt,
} from "@/lib/pipeline/prompts/paper";
import {
  IMAGE_EXAMPLE,
  retryPrompt,
  STEP_SYSTEM_PROMPT,
  stepContextPrompt,
  VIZ_EXAMPLES,
  WIDGET_EXAMPLES,
} from "@/lib/pipeline/prompts/step";
import { PARAM_NAME_RE, WIDGET_LIMITS } from "@/shared/widget";
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
  it("offers at most one image (E1, #152), in objectsJson, never in objects, with no text in the picture", () => {
    expect(STEP_SYSTEM_PROMPT).toContain("# Illustrations");
    expect(STEP_SYSTEM_PROMPT).toContain("A step may also draw one image");
    expect(STEP_SYSTEM_PROMPT).toContain("It goes in objectsJson");
    // The board section (shared with sketches) no longer says there are no images.
    expect(STEP_SYSTEM_PROMPT).not.toContain("no images");
    expect(STEP_SYSTEM_PROMPT).toContain(
      "no letters, words, numbers, labels, symbols or equations",
    );
    expect(STEP_SYSTEM_PROMPT).toContain("clear of every other object");
  });

  it("the image example is a valid wire image, 16:9 like fal's image, and its prompt asks for no text", () => {
    const parsed = WireImageObject.parse(IMAGE_EXAMPLE);
    expect(parsed.w / parsed.h).toBeCloseTo(16 / 9);
    expect(IMAGE_EXAMPLE.prompt).toMatch(/No text/);
    expect(STEP_SYSTEM_PROMPT).toContain(
      `objectsJson: ${JSON.stringify(JSON.stringify([IMAGE_EXAMPLE]))}`,
    );
  });

  it("asks for maths spelled out in the narration (TTS reads symbols badly, S1)", () => {
    expect(STEP_SYSTEM_PROMPT).toContain("spell all maths out in words");
  });

  it("asks for the plan's title, not a new one (the outline names steps by it, QA pass 2)", () => {
    expect(STEP_SYSTEM_PROMPT).toContain(
      "Title the step exactly as the lesson plan does.",
    );
    expect(STEP_SYSTEM_PROMPT).not.toContain("Give the step a short title");
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

  it("caps a matrix cell at what fits its width, and keeps words out of cells", () => {
    expect(STEP_SYSTEM_PROMPT).toContain(
      `A cell holds at most ${MATRIX_CELL_MAX_CHARS} characters`,
    );
    expect(STEP_SYSTEM_PROMPT).toContain("round numbers to fit");
    expect(STEP_SYSTEM_PROMPT).toContain("Words don't fit in cells");
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

describe("the widget section (#110)", () => {
  it("offers at most one widget, in widgetJson, left out when there's none", () => {
    expect(STEP_SYSTEM_PROMPT).toContain("# Try it yourself");
    expect(STEP_SYSTEM_PROMPT).toContain(
      "It goes in widgetJson: a string holding one JSON object. Leave widgetJson out when the step has none",
    );
    expect(STEP_SYSTEM_PROMPT).toContain('starting "Try it yourself:"');
  });

  it("states the contract's limits", () => {
    for (const limit of [
      `at most ${WIDGET_LIMITS.maxPromptChars} characters`,
      `at most ${WIDGET_LIMITS.maxExprChars} characters`,
      `0 to ${WIDGET_LIMITS.maxParams} sliders`,
      `1 to ${WIDGET_LIMITS.maxHeatmapDim} rows`,
      `is at most ${WIDGET_LIMITS.maxLabelChars} characters`,
    ])
      expect(STEP_SYSTEM_PROMPT).toContain(limit);
  });

  it("states a parameter name's length as PARAM_NAME_RE allows it (16)", () => {
    expect(STEP_SYSTEM_PROMPT).toContain("at most 16 characters, unique");
    expect(PARAM_NAME_RE.test("a".repeat(16))).toBe(true);
    expect(PARAM_NAME_RE.test("a".repeat(17))).toBe(false);
  });

  it("shows each example as the JSON string Claude writes, and each is a valid widget", () => {
    for (const widget of Object.values(WIDGET_EXAMPLES)) {
      expect(STEP_SYSTEM_PROMPT).toContain(
        JSON.stringify(JSON.stringify(widget)),
      );
      const result = validateWireStep(
        {
          title: "An example",
          narration: "Look [[go]]here. Try it yourself.",
          objects: [
            { kind: "text", id: "t", x: 800, y: 450, text: "an example" },
          ],
          objectsJson: "[]",
          actions: [
            {
              cue: "go",
              do: "highlight",
              target: { id: "t" },
              durationMs: 400,
            },
          ],
          widgetJson: JSON.stringify(widget),
        },
        { maxNarrationChars: config.maxNarrationChars },
      );
      expect(result).toMatchObject({ ok: true, value: { widget } });
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
