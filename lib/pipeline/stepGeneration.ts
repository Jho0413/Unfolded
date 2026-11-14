// The step-generation machine, per step on the server (ARCHITECTURE.md section 6.2), for the
// cells G2 builds: every cell except the A1 ones (signals, staleGenerating, started). Pure: the
// step route (lib/pipeline/lessonStep.ts) works out the state and the event, and this says what
// happens. The one retry after a first rejection runs inside lib/pipeline/generate.ts.
import "server-only";
import { TtsError } from "@/lib/narration/tts";
import { NoAlignmentError } from "@/lib/narration/cues";
import { GenerationError } from "@/lib/pipeline/generate";

export type StepGenState = "notRequested" | "generating" | "ready" | "failed";

export type StepGenEvent =
  /** POST /api/lessons/<id>/steps/<n>. */
  | { type: "request" }
  /** The script failed zod or validate.ts, on attempt 1 or 2. */
  | { type: "rejected"; attempt: 1 | 2 }
  /** The script is valid, and its audio and cue times are saved. */
  | { type: "saved" }
  /** Refusal, a Claude error after the SDK's retries, or a `max_tokens` cut-off. */
  | { type: "claudeFailed" }
  /** A TTS or quota error, or no alignment. */
  | { type: "ttsFailed" };

/** What the route does next. */
export type StepGenEffect =
  /** Start one generation of the step. */
  | "generate"
  /** Wait for the generation already running: there is never a second one. */
  | "wait"
  /** Ask Claude again, with the errors. */
  | "retry"
  /** Answer with the step saved in runs/. */
  | "serve"
  /** Answer "Couldn't make this step."; the next request generates again. */
  | "fail";

export type StepGenResult =
  | { outcome: "transition"; to: StepGenState; effect: StepGenEffect }
  | { outcome: "cantHappen"; reason: string };

const to = (state: StepGenState, effect: StepGenEffect): StepGenResult => ({
  outcome: "transition",
  to: state,
  effect,
});
const cantHappen = (reason: string): StepGenResult => ({
  outcome: "cantHappen",
  reason,
});

/** One cell of the section 6.2 table (A1 cells left out). */
export function stepTransition(
  state: StepGenState,
  event: StepGenEvent,
): StepGenResult {
  if (event.type === "request") {
    switch (state) {
      case "notRequested":
        return to("generating", "generate");
      case "generating":
        return to("generating", "wait");
      case "ready":
        return to("ready", "serve");
      case "failed":
        // A new request after a failure tries again: this is the player's Retry.
        return to("generating", "generate");
    }
  }
  if (state !== "generating")
    return cantHappen(
      state === "ready"
        ? "the step is saved: nothing is generating it"
        : "nothing is generating the step",
    );
  switch (event.type) {
    case "rejected":
      return event.attempt === 1
        ? to("generating", "retry")
        : to("failed", "fail");
    case "saved":
      return to("ready", "serve");
    case "claudeFailed":
    case "ttsFailed":
      return to("failed", "fail");
  }
}

/** The state of a step the route isn't generating right now, from what it knows. */
export function idleStepState(
  saved: boolean,
  failedBefore: boolean,
): StepGenState {
  if (saved) return "ready";
  return failedBefore ? "failed" : "notRequested";
}

/**
 * The section 6.2 event a generation's error is, or undefined for an error outside the table
 * (a bug, a failed save, a missing paper.json), which also fails the step.
 */
export function failureEvent(err: unknown): StepGenEvent | undefined {
  if (err instanceof GenerationError)
    return err.reason === "rejected"
      ? { type: "rejected", attempt: 2 }
      : { type: "claudeFailed" };
  if (err instanceof TtsError || err instanceof NoAlignmentError)
    return { type: "ttsFailed" };
  return undefined;
}
