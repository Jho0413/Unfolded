// Saved lesson runs for the lesson page tests (ROADMAP P6): runs/<lessonId>/ written the way
// lib/runs/store.ts lays it out (plan.json, step-<n>.v<k>.json and step-<n>.v<k>.mp3), from
// the demo-m1 step fixture and the dev board's cue times, with a silent MP3 of known length.
// No provider is called: this stands in for a run made by `npm run make:m1` (C1).
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { M1_CUE_TIMES } from "@/app/dev/board/scenes";
import demoM1 from "@/lib/fakes/fixtures/demo-m1.step.json";
import type { LessonPlan, SavedStep } from "@/shared/lesson";
import { Step } from "@/shared/scene";

// The server's config.runsDir. lib/config.ts imports "server-only", so it can't be imported here.
export const RUNS_DIR = path.join(process.cwd(), "runs");

/** Long enough for every demo-m1 cue time, plus the last fade. */
export const SAVED_AUDIO_MS = 9000;

/** MPEG-1 Layer III, 128 kbit/s, 44.1 kHz, mono: 417 bytes and 1152 samples per frame. */
const FRAME_HEADER = [0xff, 0xfb, 0x90, 0xc4];
const FRAME_BYTES = 417;
const FRAME_MS = (1152 / 44100) * 1000;

/**
 * A silent MP3 of about `durationMs`: frames whose side information is all zeros, so every
 * granule decodes to silence. Made on the fly, so no binary is committed.
 */
export function silentMp3(durationMs: number): Uint8Array {
  const frames = Math.ceil(durationMs / FRAME_MS);
  const bytes = new Uint8Array(frames * FRAME_BYTES);
  for (let i = 0; i < frames; i++) bytes.set(FRAME_HEADER, i * FRAME_BYTES);
  return bytes;
}

export const m1Step = Step.parse(demoM1);

/** The title of saved step n, so a test can see which step is on screen. */
export function savedStepTitle(n: number): string {
  return `${m1Step.title} (saved step ${n + 1})`;
}

export interface SavedRunOptions {
  /** Plan steps; the default is 2. */
  steps?: number;
  /** Steps with no saved file (0-based). */
  unsaved?: number[];
  /** Saved versions per step (the page plays the latest); the default is 1. */
  versions?: number;
}

/** Writes runs/<lessonId>/ and returns a handle that removes it. */
export async function savedRun(
  lessonId: string,
  options: SavedRunOptions = {},
) {
  const { steps = 2, unsaved = [], versions = 1 } = options;
  const dir = path.join(RUNS_DIR, lessonId);
  await mkdir(dir, { recursive: true });
  const plan: LessonPlan = {
    title: "Matrix multiplication",
    coverPrompt: "a whiteboard with two matrices",
    steps: Array.from({ length: steps }, (_, n) => ({
      title: savedStepTitle(n),
      goal: "Multiply two matrices",
    })),
  };
  await writeFile(path.join(dir, "plan.json"), JSON.stringify(plan));
  const audio = silentMp3(SAVED_AUDIO_MS);
  for (let n = 0; n < steps; n++) {
    if (unsaved.includes(n)) continue;
    for (let k = 1; k <= versions; k++) {
      const title =
        k === versions ? savedStepTitle(n) : `${savedStepTitle(n)} old v${k}`;
      const saved: SavedStep = {
        step: { ...m1Step, title },
        cueTimes: M1_CUE_TIMES,
      };
      await writeFile(path.join(dir, `step-${n}.v${k}.mp3`), audio);
      await writeFile(
        path.join(dir, `step-${n}.v${k}.json`),
        JSON.stringify(saved),
      );
    }
  }
  return {
    lessonId,
    [Symbol.asyncDispose]: () => rm(dir, { recursive: true, force: true }),
  };
}
