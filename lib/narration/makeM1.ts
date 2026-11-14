// `npm run make:m1` (ROADMAP C1): the demo-m1 step fixture -> runs/demo-m1/, the saved run
// the lesson page plays (P6). Writes plan.json (a one-step plan: L1 and seed:m2 make real
// plans, the step route never does), then step-0.v<k>.json (SavedStep) and its audio
// through the run store, so the runs folder always comes from config. scripts/make-m1.ts
// is the command line around this.
import "server-only";
import { LessonPlan, SavedStep, type CueTimes } from "@/shared/lesson";
import { validateStep } from "@/shared/validate";
import { config } from "@/lib/config";
import { readFixture } from "@/lib/fakes";
import { stripMarkers, type Alignment } from "@/lib/narration/cues";
import { narrate, type TtsEnv } from "@/lib/narration/tts";
import { saveStepVersion, writeRunJson } from "@/lib/runs/store";

export const M1_LESSON_ID = "demo-m1";
export const M1_FIXTURE = "demo-m1.step.json";

export interface MadeM1 {
  /** The version saved as step-0.v<version>.json and .mp3. */
  version: number;
  text: string;
  cueTimes: CueTimes;
  alignment: Alignment | null;
  audioBytes: number;
}

export async function makeM1(env: TtsEnv): Promise<MadeM1> {
  const checked = validateStep(await readFixture(M1_FIXTURE), {
    maxNarrationChars: config.maxNarrationChars,
  });
  if (!checked.ok)
    throw new Error(
      `${M1_FIXTURE} is not a valid step: ${checked.errors.join("; ")}`,
    );
  const step = checked.value;

  const narrated = await narrate(step.narration, env);

  const plan = LessonPlan.parse({
    title: step.title,
    steps: [
      { title: step.title, goal: "Multiply two matrices, one entry at a time" },
    ],
    coverPrompt: "a whiteboard with two small matrices being multiplied",
  });
  await writeRunJson(M1_LESSON_ID, "plan.json", plan);
  const saved = SavedStep.parse({ step, cueTimes: narrated.cueTimes });
  const version = await saveStepVersion(M1_LESSON_ID, 0, saved, narrated.audio);

  return {
    version,
    text: narrated.text,
    cueTimes: narrated.cueTimes,
    alignment: narrated.alignment,
    audioBytes: narrated.audio.length,
  };
}

export interface CueRow {
  cue: string;
  /** The word the cue's marker sits before. */
  word: string;
  /** The cue time from the alignment walk (cues.ts). */
  ms: number;
  /**
   * An independent check: the start time of the alignment entry at the cue's code point
   * index (S1: one entry per code point, echoing the text). Undefined past the end.
   */
  indexMs: number | undefined;
}

/** The cue -> word -> time table `make:m1` prints. */
export function cueTable(
  narration: string,
  cueTimes: CueTimes,
  alignment: Alignment | null,
): CueRow[] {
  const { text, cues } = stripMarkers(narration);
  return cues.map(({ cue, offset }) => {
    const rest = text.slice(offset).trimStart();
    const word = (rest.split(/\s/, 1)[0] ?? "").replace(
      /[^\p{L}\p{N}'’-]+$/u,
      "",
    );
    // Skip spaces like cues.ts does, then count code points, not UTF-16 units.
    const at = offset + (text.length - offset - rest.length);
    const index = Array.from(text.slice(0, at)).length;
    const s = alignment?.character_start_times_seconds[index];
    return {
      cue,
      word,
      ms: cueTimes[cue],
      indexMs: s === undefined ? undefined : Math.round(s * 1000),
    };
  });
}
