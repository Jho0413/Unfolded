// `npm run make:m1` (ROADMAP C1): the demo-m1 step fixture -> runs/demo-m1/, the saved run
// the lesson page plays (P6). Writes step-0.v<k>.json (SavedStep) and its audio, then
// plan.json (a one-step plan: L1 and seed:m2 make real plans, the step route never does),
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
  /** The validated step's narration, with its [[cue]] markers. */
  narration: string;
  text: string;
  cueTimes: CueTimes;
  alignment: Alignment | null;
  audioBytes: number;
  /** The MP3's length from its frames, or undefined if it isn't MPEG-1 Layer III. */
  audioMs: number | undefined;
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

  const saved = SavedStep.parse({ step, cueTimes: narrated.cueTimes });
  const version = await saveStepVersion(M1_LESSON_ID, 0, saved, narrated.audio);
  // The plan goes last: a plan with no step would load as "step not in run".
  const plan = LessonPlan.parse({
    title: step.title,
    steps: [
      { title: step.title, goal: "Multiply two matrices, one entry at a time" },
    ],
    coverPrompt: "a whiteboard with two small matrices being multiplied",
  });
  await writeRunJson(M1_LESSON_ID, "plan.json", plan);

  return {
    version,
    narration: step.narration,
    text: narrated.text,
    cueTimes: narrated.cueTimes,
    alignment: narrated.alignment,
    audioBytes: narrated.audio.length,
    audioMs: mp3DurationMs(narrated.audio),
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

const MPEG1_L3_KBPS = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
];
const MPEG1_RATES = [44100, 48000, 32000];

/**
 * The length of an MPEG-1 Layer III file (config.tts.outputFormat) from its frame headers,
 * without decoding: 1152 samples per frame. It runs a little long (up to about 80 ms): the
 * encoder's delay, padding and info frame count as audio here. Undefined when no frame
 * parses, e.g. another format.
 */
export function mp3DurationMs(bytes: Uint8Array): number | undefined {
  let i = 0;
  // An ID3v2 tag: a 10-byte header and a syncsafe size.
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    i =
      10 +
      (((bytes[6] & 0x7f) << 21) |
        ((bytes[7] & 0x7f) << 14) |
        ((bytes[8] & 0x7f) << 7) |
        (bytes[9] & 0x7f));
  }
  let frames = 0;
  let rate = 0;
  while (i + 4 <= bytes.length) {
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const kbps = MPEG1_L3_KBPS[b2 >> 4];
    const sampleRate = MPEG1_RATES[(b2 >> 2) & 3];
    // Sync, MPEG-1 (11), Layer III (01), a real bitrate and sample rate.
    if (bytes[i] !== 0xff || (b1 & 0xfe) !== 0xfa || !kbps || !sampleRate) {
      i++;
      continue;
    }
    frames++;
    rate = sampleRate;
    i += Math.floor((144000 * kbps) / sampleRate) + ((b2 >> 1) & 1);
  }
  return frames === 0 ? undefined : Math.round((frames * 1152 * 1000) / rate);
}
