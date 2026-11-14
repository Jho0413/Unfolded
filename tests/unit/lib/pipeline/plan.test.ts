// lib/pipeline/plan.ts (ROADMAP L1, ARCHITECTURE.md section 5.1): plan validation, the plan
// request and lesson ids. The route tests cover the upload and plan rows of section 7.
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { config } from "@/lib/config";
import { PLAN_OUTPUT_FORMAT } from "@/lib/pipeline/outputFormat";
import {
  buildPlanRequest,
  newLessonId,
  tooFewSteps,
  validatePlan,
} from "@/lib/pipeline/plan";
import { PLAN_SYSTEM_PROMPT } from "@/lib/pipeline/prompts/plan";
import {
  LESSON_ID_RE,
  LessonPlanOutput,
  MAX_PLAN_STEPS,
} from "@/shared/lesson";

const step = (i: number) => ({ title: `Step ${i}`, goal: `Teach idea ${i}.` });
const plan = (n: number): LessonPlanOutput => ({
  title: "A lesson",
  coverPrompt: "a cover",
  steps: Array.from({ length: n }, (_, i) => step(i)),
});

describe("validatePlan", () => {
  it("a plan with config.plan.minSteps steps is valid", () => {
    expect(validatePlan(plan(config.plan.minSteps))).toEqual({
      ok: true,
      value: plan(config.plan.minSteps),
    });
  });

  it("a plan with MAX_PLAN_STEPS steps is valid", () => {
    expect(validatePlan(plan(MAX_PLAN_STEPS)).ok).toBe(true);
  });

  it("fewer than config.plan.minSteps steps: too few steps", () => {
    const n = config.plan.minSteps - 1;
    expect(validatePlan(plan(n))).toEqual({
      ok: false,
      errors: [tooFewSteps(n)],
    });
  });

  it("more than MAX_PLAN_STEPS steps: the schema error", () => {
    const result = validatePlan(plan(MAX_PLAN_STEPS + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/^steps:/);
  });

  it("a missing coverPrompt: the schema error with its path", () => {
    const result = validatePlan({
      ...plan(config.plan.minSteps),
      coverPrompt: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/^coverPrompt:/);
  });
});

describe("buildPlanRequest", () => {
  const body = buildPlanRequest("file_test123");

  it("uses the plan model, effort and output cap from lib/config.ts", () => {
    expect(body.model).toBe(config.models.plan);
    expect(body.output_config?.effort).toBe(config.effort.plan);
    expect(body.max_tokens).toBe(config.plan.maxTokens);
  });

  it("asks for structured output with the LessonPlanOutput schema", () => {
    expect(body.output_config?.format).toBe(PLAN_OUTPUT_FORMAT);
    expect(PLAN_OUTPUT_FORMAT).toEqual({
      type: "json_schema",
      schema: zodOutputFormat(LessonPlanOutput).schema,
    });
  });

  it("sends the paper by file id as a cached document, before the text", () => {
    const content = body.messages[0].content;
    expect(Array.isArray(content) && content[0]).toEqual({
      type: "document",
      source: { type: "file", file_id: "file_test123" },
      cache_control: { type: "ephemeral" },
    });
    expect(Array.isArray(content) && content[1].type).toBe("text");
  });

  it("the system prompt asks for the configured step range", () => {
    expect(body.system).toBe(PLAN_SYSTEM_PROMPT);
    expect(PLAN_SYSTEM_PROMPT).toContain(
      `${config.plan.minSteps} to ${MAX_PLAN_STEPS} steps`,
    );
  });
});

describe("newLessonId", () => {
  const cases: [string, string, string][] = [
    [
      "a plain title",
      "Attention Is All You Need",
      "attention-is-all-you-need-abc123",
    ],
    [
      "punctuation and spaces collapse to one dash",
      "  Why √d? Scaling: dot products!  ",
      "why-d-scaling-dot-products-abc123",
    ],
    [
      "a long title is cut, with no trailing dash",
      "A very long title that goes on and on and on",
      "a-very-long-title-that-goes-on-abc123",
    ],
    [
      "a cut that ends on a separator drops its trailing dash",
      "abcdefghij abcdefghij abcdefg xyz",
      "abcdefghij-abcdefghij-abcdefg-abc123",
    ],
    [
      "a title with no letters or digits falls back to lesson",
      "∑∫√",
      "lesson-abc123",
    ],
    ["an empty title falls back to lesson", "", "lesson-abc123"],
  ];
  for (const [name, title, want] of cases)
    it(`${name}: ${want}`, () =>
      expect(newLessonId(title, "abc123")).toBe(want));

  it("property: any title with an 8-hex suffix gives an id that matches LESSON_ID_RE", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: "grapheme", maxLength: 200 }),
        fc.stringMatching(/^[0-9a-f]{8}$/),
        (title, suffix) => {
          expect(newLessonId(title, suffix)).toMatch(LESSON_ID_RE);
        },
      ),
    );
  });
});
