// The fake lesson behind the dev-only /dev/player page (ROADMAP P5): two
// steps of the hand-written demo-m1 step, with the dev board's cue times and
// a silent audio track from ./audio. Query parameters pick a failure, so
// Playwright can drive every player state without a server or a provider:
//
//   ?fail=1           step 2's first request fails (Retry then loads it)
//   ?audio=broken     the audio isn't audio (it fails to decode)
//   ?audio=missing    the audio request answers 404
//   ?delay=ms         each step request takes this long (shows `loading`)
//   ?debug=1          the player's debug overlay
import type { FetchStep } from "@/player/usePlayer";
import { MESSAGES } from "@/player/machine";
import type { StepResponse } from "@/shared/lesson";
import { m1, M1_CUE_TIMES } from "../board/scenes";

export const FAKE_STEP_COUNT = 2;

/** Long enough for every demo-m1 cue time, plus the last fade. */
export const FAKE_AUDIO_MS = 9000;

export const AUDIO_KINDS = ["ok", "broken", "missing"] as const;
export type AudioKind = (typeof AUDIO_KINDS)[number];

/** Above this, a delay would only slow the tests down. */
const MAX_DELAY_MS = 5000;

export interface FakeOptions {
  fail: boolean;
  audio: AudioKind;
  delayMs: number;
  debug: boolean;
}

type Params = { [key: string]: string | string[] | undefined };

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function isAudioKind(v: string | undefined): v is AudioKind {
  return (AUDIO_KINDS as readonly (string | undefined)[]).includes(v);
}

/** The page's query, checked once here: anything unknown gets the default. */
export function parseFakeOptions(params: Params): FakeOptions {
  const audio = first(params.audio);
  const delay = Number(first(params.delay) ?? 0);
  return {
    fail: first(params.fail) === "1",
    audio: isAudioKind(audio) ? audio : "ok",
    delayMs:
      Number.isFinite(delay) && delay > 0 ? Math.min(delay, MAX_DELAY_MS) : 0,
    debug: first(params.debug) === "1",
  };
}

/** The fake step request. Each call to this makes a fresh lesson (attempts counted from 0). */
export function fakeFetchStep(options: FakeOptions): FetchStep {
  const attempts = new Map<number, number>();
  return async (n) => {
    const attempt = (attempts.get(n) ?? 0) + 1;
    attempts.set(n, attempt);
    if (options.delayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    if (options.fail && n === 1 && attempt === 1)
      return { error: MESSAGES.stepFailed };
    const response: StepResponse = {
      step: { ...m1, title: `${m1.title} (fake step ${n + 1})` },
      version: 1,
      audioUrl: `/dev/player/audio?kind=${options.audio}`,
      cueTimes: M1_CUE_TIMES,
    };
    return response;
  };
}
