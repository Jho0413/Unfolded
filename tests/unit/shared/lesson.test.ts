// Run file names and URLs (shared/lesson.ts, ARCHITECTURE.md section 5.1).
import { describe, expect, it } from "vitest";
import { RUN_FILE_RE, isRunFileUrl } from "@/shared/lesson";

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
