// Loads a step for the player (ARCHITECTURE.md sections 5.1 and 6.1): the
// step request, then its audio as a blob played from a `blob:` URL (so
// seeking works without HTTP Range support). No React: usePlayer gives it
// callbacks, and tests give it fakes.
//
// Only the latest request may report back. An older one that finishes later
// (the machine has moved on) is dropped and logged, and its blob URL freed.
import type { ApiError, StepResponse } from "@/shared/lesson";
import { MESSAGES } from "./machine";
import { type TimedAction, timeline } from "./sceneAt";

/**
 * Requests step `n` (0-based). Resolves to the step, or to the server's
 * error body, whose message the learner sees. A rejection (network down) is
 * logged and shown as `MESSAGES.stepFailed`. The caller validates the
 * response at its boundary.
 */
export type FetchStep = (n: number) => Promise<StepResponse | ApiError>;

/** A step whose script and audio have both arrived. */
export interface LoadedStep {
  step: number;
  response: StepResponse;
  timed: TimedAction[];
  /** The audio as a `blob:` URL; whoever keeps the step frees it. */
  src: string;
}

export interface StepLoaderDeps {
  fetchStep: FetchStep;
  fetchAudio: (url: string) => Promise<Blob>;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
  /** The latest request's step arrived (script and audio). */
  ready: (loaded: LoadedStep) => void;
  /** The latest request failed; `message` is for the learner. */
  failed: (step: number, message: string) => void;
  log: Pick<Console, "error" | "info">;
}

export interface StepLoader {
  load: (step: number) => Promise<void>;
  /** Drops every request in flight (the player unmounted). */
  cancel: () => void;
}

/** The audio download, as the browser does it. */
export async function fetchAudioBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

export function createStepLoader(deps: StepLoaderDeps): StepLoader {
  let latest = 0;

  async function load(step: number): Promise<void> {
    const request = ++latest;
    const stale = () => {
      if (request === latest) return false;
      deps.log.info(`[player] late reply for step ${step} dropped`);
      return true;
    };

    let response: StepResponse;
    try {
      const reply = await deps.fetchStep(step);
      if ("error" in reply) {
        if (!stale()) deps.failed(step, reply.error);
        return;
      }
      response = reply;
    } catch (error) {
      deps.log.error(`[player] step ${step} request failed`, error);
      if (!stale()) deps.failed(step, MESSAGES.stepFailed);
      return;
    }

    let src: string;
    try {
      src = deps.createUrl(await deps.fetchAudio(response.audioUrl));
    } catch (error) {
      deps.log.error(`[player] step ${step} audio failed to load`, error);
      if (!stale()) deps.failed(step, MESSAGES.audioFailed);
      return;
    }
    if (stale()) {
      deps.revokeUrl(src);
      return;
    }
    const timed = timeline(response.step.actions, response.cueTimes);
    deps.ready({ step, response, timed, src });
  }

  return {
    load,
    cancel: () => {
      latest++;
    },
  };
}
