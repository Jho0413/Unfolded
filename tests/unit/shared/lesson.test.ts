// Run file names and URLs (shared/lesson.ts, ARCHITECTURE.md section 5.1).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  LESSON_ID_RE,
  RUN_FILE_RE,
  StepResponse,
  isRunFileUrl,
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
