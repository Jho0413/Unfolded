// lib/narration/makeM1.ts (npm run make:m1, ROADMAP C1): writes runs/demo-m1/ in the shape
// the lesson page reads (P6), through the run store, here into a temporary runs folder.
// Fake mode only: no ElevenLabs call.
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LessonPlan, SavedStep } from "@/shared/lesson";
import { alignmentOf } from "@/lib/narration/tts";
import {
  cueTable,
  makeM1,
  mp3DurationMs,
  M1_LESSON_ID,
} from "@/lib/narration/makeM1";

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

  it("a step that fails to save leaves no plan.json behind", async () => {
    const store = await import("@/lib/runs/store");
    const save = vi
      .spyOn(store, "saveStepVersion")
      .mockRejectedValueOnce(new Error("disk full"));
    await expect(makeM1({ mode: "fake" })).rejects.toThrow("disk full");
    expect(save).toHaveBeenCalled();
    expect(await readdir(dirs.runs)).toEqual([]);
  });

  it("returns the validated narration and the MP3 length from its frames", async () => {
    const made = await makeM1({ mode: "fake" });
    expect(made.narration).toContain("[[row]]");
    // The fixture's audio is cut to 3072 bytes: 7 whole 128 kbit/s frames, then a partial one.
    expect(made.audioMs).toBe(Math.round((8 * 1152 * 1000) / 44100));
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

describe("mp3DurationMs", () => {
  /** MPEG-1 Layer III, 128 kbit/s, 44.1 kHz, mono: 417 bytes (418 padded) per frame. */
  const frame = (padded = false) => {
    const f = new Uint8Array(padded ? 418 : 417);
    f.set([0xff, 0xfb, padded ? 0x92 : 0x90, 0xc4]);
    return f;
  };
  const join = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };

  it("counts 1152 samples per frame, padded frames included", () => {
    const frames = [frame(), frame(true), frame(), frame(true)];
    expect(mp3DurationMs(join(...frames))).toBe(
      Math.round((4 * 1152 * 1000) / 44100),
    );
  });

  it("skips an ID3v2 tag", () => {
    const tag = new Uint8Array(10 + 20);
    tag.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20]);
    tag.fill(0xff, 10); // tag bytes that look like sync must not count
    expect(mp3DurationMs(join(tag, frame(), frame()))).toBe(
      Math.round((2 * 1152 * 1000) / 44100),
    );
  });

  it("is undefined for bytes with no MPEG-1 Layer III frame", () => {
    expect(mp3DurationMs(new Uint8Array(1000))).toBeUndefined();
    expect(
      mp3DurationMs(new TextEncoder().encode("RIFF....WAVE")),
    ).toBeUndefined();
  });
});
