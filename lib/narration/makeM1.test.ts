// lib/narration/makeM1.ts (npm run make:m1, ROADMAP C1): writes runs/demo-m1/ in the shape
// the lesson page reads (P6), through the run store, here into a temporary runs folder.
// Fake mode only: no ElevenLabs call.
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LessonPlan, SavedStep } from "@/shared/lesson";
import { alignmentOf } from "@/lib/narration/tts";
import { cueTable, makeM1, M1_LESSON_ID } from "@/lib/narration/makeM1";

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

beforeEach(async () => {
  dirs.runs = await mkdtemp(path.join(tmpdir(), "make-m1-runs-"));
});
afterEach(() => rm(dirs.runs, { recursive: true, force: true }));

const runFile = (file: string) =>
  readFile(path.join(dirs.runs, M1_LESSON_ID, file));

describe("makeM1", () => {
  it("writes plan.json, step-0.v1.json (SavedStep) and its audio into config.runsDir", async () => {
    const made = await makeM1({ mode: "fake" });
    expect(made.version).toBe(1);
    expect((await readdir(path.join(dirs.runs, M1_LESSON_ID))).sort()).toEqual([
      "plan.json",
      "step-0.v1.json",
      "step-0.v1.mp3",
    ]);

    const plan = LessonPlan.parse(
      JSON.parse((await runFile("plan.json")).toString()),
    );
    expect(plan.steps).toHaveLength(1);
    const saved = SavedStep.parse(
      JSON.parse((await runFile("step-0.v1.json")).toString()),
    );
    expect(plan.steps[0].title).toBe(saved.step.title);
    expect(saved.cueTimes).toEqual(made.cueTimes);
    expect(saved.cueTimes.row).toBe(2601);
    expect((await runFile("step-0.v1.mp3")).length).toBe(made.audioBytes);
  });

  it("a second run saves a new version and keeps the first", async () => {
    await makeM1({ mode: "fake" });
    expect((await makeM1({ mode: "fake" })).version).toBe(2);
    expect(await readdir(path.join(dirs.runs, M1_LESSON_ID))).toContain(
      "step-0.v1.json",
    );
  });

  it("replay mode writes nothing", async () => {
    await expect(
      makeM1({ mode: "replay", replayRun: M1_LESSON_ID }),
    ).rejects.toMatchObject({ reason: "unavailable" });
    expect(await readdir(dirs.runs)).toEqual([]);
  });
});

describe("cueTable", () => {
  it("names the word after each cue, and checks it against the alignment entry at its code point", () => {
    const narration = "Take 🙂 the [[r]]row, [[c]]column.[[end]]";
    const text = "Take 🙂 the row, column.";
    const alignment = alignmentOf(text, 100);
    const rows = cueTable(
      narration,
      { r: 1100, c: 1600, end: 2300 },
      alignment,
    );
    expect(rows).toEqual([
      { cue: "r", word: "row", ms: 1100, indexMs: 1100 },
      { cue: "c", word: "column", ms: 1600, indexMs: 1600 },
      { cue: "end", word: "", ms: 2300, indexMs: undefined },
    ]);
  });
});
