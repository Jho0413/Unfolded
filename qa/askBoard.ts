// The board during Ask (ARCHITECTURE.md sections 5.3 and 8). Pure. The lesson
// board stays frozen at `pausedT`; highlights draw on top of it, each timed
// from when it arrived. A drawn answer (#105) replaces it: a narrated sketch on
// an empty board, its actions on their cues and its clock its own narration's
// audio, like a step. Closing Ask throws the layer away (the page goes back to
// `sceneAt(step, pausedT)`).
import { sceneAt, timeline, type TimedAction } from "@/player/sceneAt";
import type { CueTimes } from "@/shared/lesson";
import type { Action, SceneObject, BoardState, Sketch } from "@/shared/scene";

/**
 * What Ask drew: highlights with times in ms since Ask opened, or a drawn answer with times
 * in ms into its narration.
 */
export type AskLayer = {
  objects: readonly SceneObject[];
  timed: readonly TimedAction[];
  /** A drawn answer started an empty board: the lesson board is left out. */
  fresh: boolean;
};

export const EMPTY_LAYER: AskLayer = { objects: [], timed: [], fresh: false };

/** The frozen lesson board: the step's objects and timeline, at `pausedT`. */
export type FrozenBoard = {
  objects: readonly SceneObject[];
  timed: readonly TimedAction[];
  pausedT: number;
};

/** Adds one action (a `highlight` tool call) that arrived `atMs` after Ask opened. */
export function addAction(
  layer: AskLayer,
  action: Action,
  atMs: number,
): AskLayer {
  return {
    ...layer,
    timed: [
      ...layer.timed,
      { action, startMs: atMs, durationMs: action.durationMs },
    ],
  };
}

/**
 * A drawn answer (always fresh, section 8): the sketch alone, on an empty board, its actions
 * timed by its narration's cue times as a step's are. It replaces what came before.
 */
export function answerLayer(sketch: Sketch, cueTimes: CueTimes): AskLayer {
  return {
    fresh: true,
    objects: sketch.objects,
    timed: timeline(sketch.actions, cueTimes),
  };
}

/**
 * The board `sinceOpenMs` after Ask opened: the frozen lesson board with Ask's highlights, or a
 * drawn answer at `answerMs` into its narration (Infinity once it's over: the whole drawing).
 */
export function askScene(
  frozen: FrozenBoard,
  layer: AskLayer,
  sinceOpenMs: number,
  answerMs: number,
): BoardState {
  if (layer.fresh) return sceneAt(layer.objects, layer.timed, answerMs);
  const { pausedT } = frozen;
  const drawn = layer.timed.map((t) => ({
    ...t,
    startMs: pausedT + t.startMs,
  }));
  const lesson = frozen.timed.filter((t) => t.startMs <= pausedT);
  return sceneAt(
    [...frozen.objects, ...layer.objects],
    [...lesson, ...drawn],
    pausedT + Math.max(0, sinceOpenMs),
  );
}
