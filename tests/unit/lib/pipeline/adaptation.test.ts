// Adaptation's pure decisions (ROADMAP A1, ARCHITECTURE.md section 5.4 and the A1 cells of
// section 6.2). The route tests (tests/unit/app/api/step-route.test.ts and
// signals-route.test.ts) run the same rows end to end.
import { describe, expect, it } from "vitest";
import {
  adaptedFrom,
  isStale,
  playedVersion,
  signalsSince,
} from "@/lib/pipeline/adaptation";
import type { Signal } from "@/shared/lesson";

const q1: Signal = { question: "why divide by root d?", step: 0, t: 1200 };
const s1: Signal = { simplify: "too fast", step: 1, t: 300 };
const q2: Signal = { question: "what is a key?", step: 1, t: 900 };

describe("isStale (ready x newer signal)", () => {
  it("stale: made with an older signals version, not started", () => {
    expect(
      isStale({
        savedWith: 0,
        failedWith: undefined,
        current: 1,
        started: false,
      }),
    ).toBe(true);
  });

  it("stale: made before signals existed (no signalsVersion) and the lesson has one", () => {
    expect(
      isStale({
        savedWith: undefined,
        failedWith: undefined,
        current: 1,
        started: false,
      }),
    ).toBe(true);
  });

  it("not stale: made with the same signals version", () => {
    expect(
      isStale({
        savedWith: 2,
        failedWith: undefined,
        current: 2,
        started: false,
      }),
    ).toBe(false);
  });

  it("not stale: no signals at all (a missing signals.json is version 0)", () => {
    expect(
      isStale({
        savedWith: undefined,
        failedWith: undefined,
        current: 0,
        started: false,
      }),
    ).toBe(false);
  });

  it("started x newer signal: ignored, a started step is never stale", () => {
    expect(
      isStale({
        savedWith: 0,
        failedWith: undefined,
        current: 3,
        started: true,
      }),
    ).toBe(false);
  });

  it("a regeneration that failed with this version keeps the older one: not stale until a newer signal", () => {
    expect(
      isStale({ savedWith: 0, failedWith: 1, current: 1, started: false }),
    ).toBe(false);
    expect(
      isStale({ savedWith: 0, failedWith: 1, current: 2, started: false }),
    ).toBe(true);
  });
});

describe("playedVersion", () => {
  it("undefined when step n never started", () => {
    expect(playedVersion([q1, { started: 1, version: 1 }], 0)).toBeUndefined();
  });

  it("the version that started last", () => {
    expect(
      playedVersion(
        [
          { started: 0, version: 1 },
          q1,
          { started: 0, version: 2 },
          { started: 1, version: 1 },
        ],
        0,
      ),
    ).toBe(2);
  });
});

describe("signalsSince", () => {
  const signals: Signal[] = [q1, { started: 0, version: 1 }, s1, q2];

  it("all questions and simplify requests since version 0, oldest first, no started", () => {
    expect(signalsSince(signals, 0)).toEqual([q1, s1, q2]);
  });

  it("only those past the version a step was made with", () => {
    expect(signalsSince(signals, 1)).toEqual([s1, q2]);
    expect(signalsSince(signals, 3)).toEqual([]);
  });
});

describe("adaptedFrom", () => {
  it("no newer signals: none (a step saved with no newer signals has no adaptedFrom)", () => {
    expect(adaptedFrom([], 1)).toBeUndefined();
  });

  it("a question: kind question, its text and the step it was asked at", () => {
    expect(adaptedFrom([{ question: "why?", step: 0, t: 5 }], 1)).toEqual({
      kind: "question",
      text: "why?",
      atStep: 0,
    });
  });

  it("several new signals: the newest only", () => {
    expect(adaptedFrom([q1, q2], 2)).toEqual({
      kind: "question",
      text: "what is a key?",
      atStep: 1,
    });
    expect(adaptedFrom([q1, { simplify: "too fast", step: 1 }], 2)).toEqual({
      kind: "simplify",
      text: "too fast",
      atStep: 1,
    });
  });

  it("a signal without `step` (an older client) is placed at the step it adapts", () => {
    expect(adaptedFrom([{ question: "why?" }], 3)).toEqual({
      kind: "question",
      text: "why?",
      atStep: 3,
    });
  });
});
