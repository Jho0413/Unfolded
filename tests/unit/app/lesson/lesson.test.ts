// The lesson page's loading (ROADMAP P6, L3): reading the plan on the server
// (app/lesson/[lessonId]/loadLesson.ts) and each step through POST
// /api/lessons/<id>/steps/<n> in the browser (stepRoute.ts), with the ARCHITECTURE.md
// section 7 messages.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLesson } from "@/app/lesson/[lessonId]/loadLesson";
import { stepRouteFetcher } from "@/app/lesson/[lessonId]/stepRoute";
import { M1_CUE_TIMES, m1 } from "@/app/dev/board/scenes";
import { MESSAGES } from "@/player/machine";
import {
  NO_SUCH_LESSON,
  STEP_NOT_IN_RUN,
  type StepResponse,
} from "@/shared/lesson";

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

  it("returns the plan, with or without saved steps", async () => {
    await save("m1", { "plan.json": JSON.stringify(PLAN) });
    expect(await loadLesson("m1")).toEqual({
      kind: "ok",
      lessonId: "m1",
      plan: PLAN,
    });
  });

  it("Route: a bad lessonId is missing", async () => {
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

describe("stepRouteFetcher", () => {
  const step: StepResponse = {
    step: m1,
    cueTimes: M1_CUE_TIMES,
    version: 2,
    audioUrl: "/api/runs/m1/step-0.v2.mp3",
  };
  const log = { error: vi.fn() };
  afterEach(() => log.error.mockReset());

  function fetcher(reply: () => Response) {
    const calls: [string, string | undefined][] = [];
    const fetchFn = async (url: string, init: RequestInit) => {
      calls.push([url, init.method]);
      return reply();
    };
    return { calls, fetchStep: stepRouteFetcher("m1", fetchFn, log) };
  }

  it("POSTs to the step route and returns its StepResponse", async () => {
    const { calls, fetchStep } = fetcher(() => Response.json(step));
    expect(await fetchStep(0)).toEqual(step);
    expect(calls).toEqual([["/api/lessons/m1/steps/0", "POST"]]);
  });

  it.each([
    [502, "Couldn't make this step."],
    [500, "Couldn't make this step."],
    [404, STEP_NOT_IN_RUN],
    [404, NO_SUCH_LESSON],
    [400, NO_SUCH_LESSON],
  ])(
    "an error reply (%i) -> its message for the player",
    async (status, error) => {
      const { fetchStep } = fetcher(() => Response.json({ error }, { status }));
      expect(await fetchStep(0)).toEqual({ error });
      expect(log.error).not.toHaveBeenCalled();
    },
  );

  it("an error with no message -> 'Couldn't make this step. Retry?', logged", async () => {
    const { fetchStep } = fetcher(
      () => new Response("<html>gateway</html>", { status: 504 }),
    );
    expect(await fetchStep(0)).toEqual({ error: MESSAGES.stepFailed });
    expect(log.error).toHaveBeenCalledOnce();
  });

  it("a reply that isn't a step -> 'Couldn't make this step. Retry?', logged", async () => {
    const { fetchStep } = fetcher(() =>
      Response.json({ step: { title: "x" } }),
    );
    expect(await fetchStep(0)).toEqual({ error: MESSAGES.stepFailed });
    expect(log.error).toHaveBeenCalledOnce();
  });

  it("a network failure rejects, for the step loader to report", async () => {
    const fetchStep = stepRouteFetcher(
      "m1",
      () => Promise.reject(new TypeError("down")),
      log,
    );
    await expect(fetchStep(0)).rejects.toThrow("down");
  });
});
