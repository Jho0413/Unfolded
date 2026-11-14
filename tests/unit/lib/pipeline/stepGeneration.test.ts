// The step-generation machine (ROADMAP G2, ARCHITECTURE.md section 6.2): one test per cell of
// the table, named "<state> x <event>", except the A1 columns and cells (adaptation tests
// those). The route tests (tests/unit/app/api/step-route.test.ts) run the same cells end to end.
import { describe, expect, it } from "vitest";
import { NoAlignmentError } from "@/lib/narration/cues";
import { TtsError } from "@/lib/narration/tts";
import { GenerationError } from "@/lib/pipeline/generate";
import {
  failureEvent,
  idleStepState,
  type StepGenEvent,
  type StepGenState,
  stepTransition,
} from "@/lib/pipeline/stepGeneration";

const request: StepGenEvent = { type: "request" };
const rejected1: StepGenEvent = { type: "rejected", attempt: 1 };
const rejected2: StepGenEvent = { type: "rejected", attempt: 2 };
const saved: StepGenEvent = { type: "saved" };
const claudeFailed: StepGenEvent = { type: "claudeFailed" };
const ttsFailed: StepGenEvent = { type: "ttsFailed" };

const transition = (to: StepGenState, effect: string) => ({
  outcome: "transition",
  to,
  effect,
});

describe("notRequested", () => {
  it("notRequested x request: -> generating", () => {
    expect(stepTransition("notRequested", request)).toEqual(
      transition("generating", "generate"),
    );
  });

  for (const [name, event] of [
    ["rejected (zod or validate)", rejected1],
    ["valid + audio + cues", saved],
    ["refusal / Claude error / max_tokens cut-off", claudeFailed],
    ["TTS or quota error, no alignment", ttsFailed],
  ] as const)
    it(`notRequested x ${name}: can't happen (nothing is generating)`, () => {
      expect(stepTransition("notRequested", event)).toMatchObject({
        outcome: "cantHappen",
      });
    });
});

describe("generating", () => {
  it("generating x request: waits for this generation (no second one)", () => {
    expect(stepTransition("generating", request)).toEqual(
      transition("generating", "wait"),
    );
  });

  it("generating x rejected, first time: retry with errors", () => {
    expect(stepTransition("generating", rejected1)).toEqual(
      transition("generating", "retry"),
    );
  });

  it("generating x rejected, second time: -> failed", () => {
    expect(stepTransition("generating", rejected2)).toEqual(
      transition("failed", "fail"),
    );
  });

  it("generating x valid + audio + cues: -> ready", () => {
    expect(stepTransition("generating", saved)).toEqual(
      transition("ready", "serve"),
    );
  });

  it("generating x refusal / Claude error / max_tokens cut-off: -> failed", () => {
    expect(stepTransition("generating", claudeFailed)).toEqual(
      transition("failed", "fail"),
    );
  });

  it("generating x TTS or quota error, no alignment: -> failed", () => {
    expect(stepTransition("generating", ttsFailed)).toEqual(
      transition("failed", "fail"),
    );
  });
});

describe("ready", () => {
  it("ready x request: returns it from runs/", () => {
    expect(stepTransition("ready", request)).toEqual(
      transition("ready", "serve"),
    );
  });

  for (const [name, event] of [
    ["rejected (zod or validate)", rejected2],
    ["valid + audio + cues", saved],
    ["refusal / Claude error / max_tokens cut-off", claudeFailed],
    ["TTS or quota error, no alignment", ttsFailed],
  ] as const)
    it(`ready x ${name}: can't happen (the step is saved)`, () => {
      expect(stepTransition("ready", event)).toEqual({
        outcome: "cantHappen",
        reason: "the step is saved: nothing is generating it",
      });
    });
});

describe("failed", () => {
  it("failed x request: -> generating (a new request after a failure tries again)", () => {
    expect(stepTransition("failed", request)).toEqual(
      transition("generating", "generate"),
    );
  });

  for (const [name, event] of [
    ["rejected (zod or validate)", rejected2],
    ["valid + audio + cues", saved],
    ["refusal / Claude error / max_tokens cut-off", claudeFailed],
    ["TTS or quota error, no alignment", ttsFailed],
  ] as const)
    it(`failed x ${name}: can't happen (nothing is generating)`, () => {
      expect(stepTransition("failed", event)).toEqual({
        outcome: "cantHappen",
        reason: "nothing is generating the step",
      });
    });
});

describe("idleStepState: the state of a step nothing is generating", () => {
  it("a saved step is ready, even after an earlier failure", () => {
    expect(idleStepState(true, false)).toBe("ready");
    expect(idleStepState(true, true)).toBe("ready");
  });
  it("an unsaved step is failed after a failure, else notRequested", () => {
    expect(idleStepState(false, true)).toBe("failed");
    expect(idleStepState(false, false)).toBe("notRequested");
  });
});

describe("failureEvent: which column a generation's error is", () => {
  it("rejected twice -> rejected (second time)", () => {
    expect(failureEvent(new GenerationError("rejected", "x"))).toEqual(
      rejected2,
    );
  });
  it("refusal, cut-off and provider errors -> Claude failed", () => {
    for (const reason of ["refusal", "cut-off", "provider"] as const)
      expect(failureEvent(new GenerationError(reason, "x"))).toEqual(
        claudeFailed,
      );
  });
  it("TTS, quota and no alignment -> TTS failed", () => {
    expect(failureEvent(new TtsError("quota", "x"))).toEqual(ttsFailed);
    expect(failureEvent(new TtsError("provider", "x"))).toEqual(ttsFailed);
    expect(failureEvent(new NoAlignmentError("t", null, "null"))).toEqual(
      ttsFailed,
    );
  });
  it("anything else is outside the table", () => {
    expect(failureEvent(new Error("disk full"))).toBeUndefined();
  });
});
