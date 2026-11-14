// The fake lesson behind the dev-only /dev/player page (ROADMAP P5): two
// steps of the hand-written demo-m1 step, with the dev board's cue times and
// a silent audio track from ./audio. Query parameters pick a failure, so
// Playwright can drive every player state without a server or a provider:
//
//   ?fail=server      step 2's first request answers with a server error
//   ?fail=network     step 2's first request rejects (network down)
//                     (either way, Retry then loads it)
//   ?audio=broken     the audio isn't audio (it fails to decode)
//   ?audio=missing    the audio request answers 404
//   ?delay=ms         each step request takes this long (shows `loading`)
//   ?debug=1          the player's debug overlay
import type { FetchStep } from "@/player/stepLoader";
import type { StepResponse } from "@/shared/lesson";
import { m1, M1_CUE_TIMES } from "../board/scenes";
import { first, type SearchParams } from "../query";

export const FAKE_STEP_COUNT = 2;

/** Long enough for every demo-m1 cue time, plus the last fade. */
export const FAKE_AUDIO_MS = 9000;

export const FAIL_KINDS = ["none", "server", "network"] as const;
export type FailKind = (typeof FAIL_KINDS)[number];

/**
 * The server's message for the failing step: one the player has no copy of,
 * so a test sees that the server's own words reach the learner.
 */
export const FAKE_SERVER_ERROR = "This step isn't in the saved run.";

export const AUDIO_KINDS = ["ok", "broken", "missing"] as const;
export type AudioKind = (typeof AUDIO_KINDS)[number];

/** Above this, a delay would only slow the tests down. */
const MAX_DELAY_MS = 5000;

export interface FakeOptions {
  fail: FailKind;
  audio: AudioKind;
  delayMs: number;
  debug: boolean;
}

function oneOf<T extends string>(
  kinds: readonly T[],
  v: string | undefined,
): v is T {
  return (kinds as readonly (string | undefined)[]).includes(v);
}

/** The page's query, checked once here: anything unknown gets the default. */
export function parseFakeOptions(params: SearchParams): FakeOptions {
  const fail = first(params.fail);
  const audio = first(params.audio);
  const delay = Number(first(params.delay) ?? 0);
  return {
    fail: oneOf(FAIL_KINDS, fail) ? fail : "none",
    audio: oneOf(AUDIO_KINDS, audio) ? audio : "ok",
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
    if (n === 1 && attempt === 1) {
      if (options.fail === "server") return { error: FAKE_SERVER_ERROR };
      if (options.fail === "network") throw new TypeError("Failed to fetch");
    }
    const response: StepResponse = {
      step: { ...m1, title: `${m1.title} (fake step ${n + 1})` },
      version: 1,
      audioUrl: `/dev/player/audio?kind=${options.audio}`,
      cueTimes: M1_CUE_TIMES,
    };
    return response;
  };
}
