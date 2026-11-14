// The board during Ask (ARCHITECTURE.md sections 5.3 and 8). Pure. The lesson
// board stays frozen at `pausedT`; highlights and sketches draw on top of it,
// each timed from when it arrived (plus `atMs` for a sketch action). After a
// `fresh` sketch, the step and earlier drawings are left out. Closing Ask
// throws the layer away (the page goes back to `sceneAt(step, pausedT)`).
import { sceneAt, type TimedAction } from "@/player/sceneAt";
import type { Action, BoardObject, BoardState, Sketch } from "@/shared/scene";

/** What Ask drew, with times in ms since Ask opened. */
export type AskLayer = {
  objects: readonly BoardObject[];
  timed: readonly TimedAction[];
  /** A fresh sketch started an empty board: the lesson board is left out. */
  fresh: boolean;
};

export const EMPTY_LAYER: AskLayer = { objects: [], timed: [], fresh: false };

/** The frozen lesson board: the step's objects and timeline, at `pausedT`. */
export type FrozenBoard = {
  objects: readonly BoardObject[];
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

/** Adds a sketch that arrived `atMs` after Ask opened; `fresh` drops what came before. */
export function addSketch(
  layer: AskLayer,
  sketch: Sketch,
  atMs: number,
  fresh: boolean,
): AskLayer {
  const base = fresh ? { ...EMPTY_LAYER, fresh: true } : layer;
  return {
    fresh: base.fresh,
    objects: [...base.objects, ...sketch.objects],
    timed: [
      ...base.timed,
      ...sketch.actions.map((a) => ({
        action: a,
        startMs: atMs + a.atMs,
        durationMs: a.durationMs,
      })),
    ],
  };
}

/** The board `sinceOpenMs` after Ask opened. */
export function askScene(
  frozen: FrozenBoard,
  layer: AskLayer,
  sinceOpenMs: number,
): BoardState {
  const { pausedT } = frozen;
  const drawn = layer.timed.map((t) => ({
    ...t,
    startMs: pausedT + t.startMs,
  }));
  const lesson = layer.fresh
    ? []
    : frozen.timed.filter((t) => t.startMs <= pausedT);
  return sceneAt(
    layer.fresh ? layer.objects : [...frozen.objects, ...layer.objects],
    [...lesson, ...drawn],
    pausedT + Math.max(0, sinceOpenMs),
  );
}
