// Run file names and URLs (shared/lesson.ts, ARCHITECTURE.md section 5.1).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  EMPTY_SIGNALS,
  LESSON_ID_RE,
  RUN_FILE_RE,
  SavedStep,
  Signal,
  SignalsFile,
  StepResponse,
  isRunFileUrl,
  signalsVersion,
} from "@/shared/lesson";

describe("run file names", () => {
  it("accept step, audio, plan and media names", () => {
    for (const name of [
      "step-0.v1.json",
      "step-0.v1.mp3",
      "plan.json",
      "cover.png",
    ])
      expect(RUN_FILE_RE.test(name)).toBe(true);
  });

  it("are never . or .., hidden, over 100 characters or outside [a-z0-9.-]", () => {
    for (const name of [
      ".",
      "..",
      ".env",
      "a/b",
      "A.json",
      "_x.tmp",
      "a".repeat(101),
    ])
      expect(RUN_FILE_RE.test(name)).toBe(false);
  });
});

describe("run file URLs", () => {
  it("accept /api/runs/<lessonId>/<file>", () => {
    expect(isRunFileUrl("/api/runs/demo-m1/step-0.v1.mp3")).toBe(true);
  });

  it("refuse other paths, traversal and absolute URLs", () => {
    for (const url of [
      "/api/runs/demo-m1/..",
      "/api/runs/../x/plan.json",
      "/api/runs/demo-m1/a/b.json",
      "https://evil.example/api/runs/demo-m1/x.mp3",
      "/api/runs/Demo/x.mp3",
    ])
      expect(isRunFileUrl(url)).toBe(false);
  });
});

describe("run file URLs, property", () => {
  it("/api/runs/<id>/<file> is accepted exactly when both parts follow their rules", () => {
    const part = (re: RegExp) => fc.oneof(fc.string(), fc.stringMatching(re));
    fc.assert(
      fc.property(part(LESSON_ID_RE), part(RUN_FILE_RE), (id, file) => {
        expect(isRunFileUrl(`/api/runs/${id}/${file}`)).toBe(
          LESSON_ID_RE.test(id) && RUN_FILE_RE.test(file),
        );
      }),
    );
  });
});

describe("StepResponse.audioUrl", () => {
  const response = (audioUrl: string) => ({
    step: { title: "t", narration: "n", objects: [], actions: [] },
    version: 1,
    audioUrl,
    cueTimes: {},
  });
  const audioUrlOk = (url: string) =>
    !StepResponse.safeParse(response(url)).error?.issues.some(
      (i) => i.path[0] === "audioUrl",
    );

  it("accepts a run file URL ending in .mp3", () => {
    expect(audioUrlOk("/api/runs/demo-m1/step-0.v1.mp3")).toBe(true);
  });

  it("refuses another extension, traversal and absolute URLs", () => {
    for (const url of [
      "/api/runs/demo-m1/step-0.v1.json",
      "/api/runs/demo-m1/..",
      "https://evil.example/api/runs/demo-m1/x.mp3",
    ])
      expect(audioUrlOk(url), url).toBe(false);
  });
});

describe("Signal (section 5.4)", () => {
  it("accepts a question or simplify with or without where it was sent", () => {
    for (const body of [
      { question: "why divide by √d?" },
      { question: "why divide by √d?", step: 2, t: 4100 },
      { simplify: "softmax lost them", step: 0 },
      { started: 3, version: 2 },
    ])
      expect(Signal.safeParse(body).success, JSON.stringify(body)).toBe(true);
  });

  it("refuses bodies of two kinds, unknown keys and bad positions", () => {
    for (const body of [
      { question: "q", simplify: "s" },
      { question: "q", started: 1, version: 1 },
      { started: 1, version: 1, step: 1 },
      { question: "q", at: "2026-11-15T03:00:00.000Z" },
      { question: "" },
      { question: "q", step: -1 },
      { question: "q", step: 1.5 },
      { simplify: "s", t: -1 },
    ])
      expect(Signal.safeParse(body).success, JSON.stringify(body)).toBe(false);
  });
});

describe("SignalsFile (section 5.4)", () => {
  const at = "2026-11-15T03:00:00.000Z";

  it("parses a file with each kind of signal and its time", () => {
    const file = {
      version: 2,
      signals: [
        { question: "why √d?", step: 1, t: 2000, at },
        { started: 2, version: 1, at },
        { simplify: "too fast", step: 2, at },
      ],
    };
    expect(SignalsFile.parse(file)).toEqual(file);
    expect(SignalsFile.parse(EMPTY_SIGNALS)).toEqual(EMPTY_SIGNALS);
  });

  it("refuses a recorded signal without a time", () => {
    expect(
      SignalsFile.safeParse({ version: 1, signals: [{ question: "q" }] })
        .success,
    ).toBe(false);
  });

  it("counts only question and simplify signals in the version", () => {
    expect(signalsVersion([])).toBe(0);
    expect(
      signalsVersion([
        { question: "a" },
        { started: 0, version: 1 },
        { simplify: "b" },
        { started: 1, version: 1 },
      ]),
    ).toBe(2);
  });
});

describe("SavedStep and StepResponse: adaptation fields", () => {
  const step = { title: "t", narration: "n", objects: [], actions: [] };
  const adaptedFrom = {
    kind: "question" as const,
    text: "why divide by √d?",
    atStep: 1,
  };

  it("an older saved step without them still parses", () => {
    expect(SavedStep.parse({ step, cueTimes: {} })).toEqual({
      step,
      cueTimes: {},
    });
  });

  it("keeps signalsVersion and adaptedFrom through the response", () => {
    const saved = { step, cueTimes: {}, signalsVersion: 3, adaptedFrom };
    expect(SavedStep.parse(saved)).toEqual(saved);
    const response = {
      ...saved,
      version: 2,
      audioUrl: "/api/runs/demo-m1/step-2.v2.mp3",
    };
    expect(StepResponse.parse(response)).toEqual(response);
  });

  it("refuses an unknown kind or a bad step", () => {
    for (const bad of [
      { ...adaptedFrom, kind: "started" },
      { ...adaptedFrom, atStep: -1 },
      { ...adaptedFrom, text: "" },
    ])
      expect(
        SavedStep.safeParse({ step, cueTimes: {}, adaptedFrom: bad }).success,
      ).toBe(false);
  });
});
