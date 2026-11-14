// The lesson page's loading (ROADMAP P6): reading a saved run on the server
// (app/lesson/[lessonId]/loadLesson.ts) and each step through GET /api/runs in
// the browser (savedSteps.ts), with the ARCHITECTURE.md section 7 messages.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLesson } from "@/app/lesson/[lessonId]/loadLesson";
import { savedStepFetcher } from "@/app/lesson/[lessonId]/savedSteps";
import { M1_CUE_TIMES, m1 } from "@/app/dev/board/scenes";
import { MESSAGES } from "@/player/machine";
import { STEP_NOT_IN_RUN, StepResponse } from "@/shared/lesson";

const dirs = vi.hoisted(() => ({ runs: "" }));
vi.mock("@/lib/config", async (importOriginal) => {
  const { config } = await importOriginal<typeof import("@/lib/config")>();
  return {
    config: {
      ...config,
      get runsDir() {
        return dirs.runs;
      },
    },
  };
});

const PLAN = {
  title: "Matrices",
  coverPrompt: "two matrices",
  steps: [
    { title: "One", goal: "g" },
    { title: "Two", goal: "g" },
    { title: "Three", goal: "g" },
  ],
};

describe("loadLesson", () => {
  beforeEach(async () => {
    dirs.runs = await mkdtemp(path.join(tmpdir(), "lesson-"));
  });
  afterEach(async () => {
    await rm(dirs.runs, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function save(id: string, files: Record<string, string>) {
    await mkdir(path.join(dirs.runs, id), { recursive: true });
    for (const [name, data] of Object.entries(files))
      await writeFile(path.join(dirs.runs, id, name), data);
  }

  it("returns the plan and the latest saved version of each step (null when none)", async () => {
    await save("m1", {
      "plan.json": JSON.stringify(PLAN),
      "step-0.v1.json": "{}",
      "step-0.v2.json": "{}",
      "step-0.v3.mp3": "", // audio claimed, JSON not written yet: not a version
      "step-2.v1.json": "{}",
    });
    expect(await loadLesson("m1")).toEqual({
      kind: "ok",
      lessonId: "m1",
      plan: PLAN,
      versions: [2, null, 1],
    });
  });

  it("Route: a bad lessonId is missing, without touching the disk", async () => {
    for (const id of ["Bad", "../x", "a".repeat(41), ""])
      expect(await loadLesson(id), id).toEqual({ kind: "missing" });
  });

  it("Route: a lesson with no folder or no plan.json is missing", async () => {
    expect(await loadLesson("nope")).toEqual({ kind: "missing" });
    await save("noplan", { "step-0.v1.json": "{}" });
    expect(await loadLesson("noplan")).toEqual({ kind: "missing" });
  });

  it("an invalid plan.json is missing, and the error is logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await save("bad", { "plan.json": '{"title":""}' });
    expect(await loadLesson("bad")).toEqual({ kind: "missing" });
    expect(error).toHaveBeenCalledOnce();
  });
});

describe("savedStepFetcher", () => {
  const saved = { step: m1, cueTimes: M1_CUE_TIMES };
  const log = { error: vi.fn() };
  afterEach(() => log.error.mockReset());

  function fetcher(reply: () => Response, versions = [3, null]) {
    const urls: string[] = [];
    const fetchFn = async (url: string) => {
      urls.push(url);
      return reply();
    };
    return { urls, fetchStep: savedStepFetcher("m1", versions, fetchFn, log) };
  }

  it("reads step-<n>.v<k>.json through the runs route and points at its .mp3", async () => {
    const { urls, fetchStep } = fetcher(() => Response.json(saved));
    const reply = await fetchStep(0);
    expect(urls).toEqual(["/api/runs/m1/step-0.v3.json"]);
    expect(StepResponse.parse(reply)).toEqual({
      ...saved,
      version: 3,
      audioUrl: "/api/runs/m1/step-0.v3.mp3",
    });
  });

  it("Step (replay): a step with no saved version -> 'This step isn't in the saved run.', no request", async () => {
    const { urls, fetchStep } = fetcher(() => Response.json(saved));
    expect(await fetchStep(1)).toEqual({ error: STEP_NOT_IN_RUN });
    expect(await fetchStep(7)).toEqual({ error: STEP_NOT_IN_RUN });
    expect(urls).toEqual([]);
  });

  it("a step file removed since the page loaded (404) isn't in the saved run", async () => {
    const { fetchStep } = fetcher(() =>
      Response.json({ error: "x" }, { status: 404 }),
    );
    expect(await fetchStep(0)).toEqual({ error: STEP_NOT_IN_RUN });
  });

  it("another HTTP error -> 'Couldn't make this step. Retry?', logged", async () => {
    const { fetchStep } = fetcher(() =>
      Response.json({ error: "x" }, { status: 500 }),
    );
    expect(await fetchStep(0)).toEqual({ error: MESSAGES.stepFailed });
    expect(log.error).toHaveBeenCalledOnce();
  });

  it("a file that isn't a saved step -> 'Couldn't make this step. Retry?', logged", async () => {
    const { fetchStep } = fetcher(() =>
      Response.json({ step: { title: "x" } }),
    );
    expect(await fetchStep(0)).toEqual({ error: MESSAGES.stepFailed });
    expect(log.error).toHaveBeenCalledOnce();
  });

  it("a network failure rejects, for the step loader to report", async () => {
    const fetchStep = savedStepFetcher(
      "m1",
      [1],
      () => Promise.reject(new TypeError("down")),
      log,
    );
    await expect(fetchStep(0)).rejects.toThrow("down");
  });
});
