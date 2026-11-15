// One lesson's Ask session state, outside React (ARCHITECTURE.md section 8):
// the Ask layer drawn on the frozen board (or a drawn answer instead, on its
// own clock), when Ask opened, and which Ask session it is. The page opens and
// closes it as the player enters and leaves `asking`; the client tools and the
// board read it. A small store, so tool handlers can read it outside render.
import type { TimedAction } from "@/player/sceneAt";
import type { CueTimes } from "@/shared/lesson";
import type { Action, SceneObject, BoardState, Sketch } from "@/shared/scene";
import {
  addAction,
  answerLayer,
  type AskLayer,
  askScene,
  EMPTY_LAYER,
  type FrozenBoard,
} from "./askBoard";

export type AskSession = ReturnType<typeof createAskSession>;

export function createAskSession(now: () => number = () => performance.now()) {
  let layer: AskLayer = EMPTY_LAYER;
  let asking = false;
  let openedAt = 0;
  let askId = 0;
  let frozen: FrozenBoard = { objects: [], timed: [], pausedT: 0 };
  // A drawn answer's clock: ms into its narration (the page's answer player sets it).
  let answerClock: () => number = () => Infinity;
  let version = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    version++;
    for (const fn of listeners) fn();
  };
  const setLayer = (next: AskLayer) => {
    layer = next;
    changed();
  };
  const sinceOpen = () => now() - openedAt;

  return {
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    /** Changes on every open, close and drawing (for useSyncExternalStore). */
    version: () => version,
    layer: () => layer,
    open(): void {
      if (asking) return;
      asking = true;
      openedAt = now();
      askId++;
      setLayer(EMPTY_LAYER);
    },
    /** Closing Ask throws the drawing away. */
    close(): void {
      if (!asking) return;
      asking = false;
      setLayer(EMPTY_LAYER);
    },
    isAsking: () => asking,
    askId: () => askId,
    /**
     * The lesson board Ask draws on: the step at `pausedT`. Frozen while
     * asking: a step that arrives during Ask shows only after it closes.
     */
    setFrozen(next: FrozenBoard): void {
      if (!asking) frozen = next;
    },
    addAction(action: Action): void {
      if (asking) setLayer(addAction(layer, action, sinceOpen()));
    },
    /** A drawn answer (#105) replaces the board, timed on its cues; any earlier one goes. */
    showAnswer(sketch: Sketch, cueTimes: CueTimes): void {
      if (asking) setLayer(answerLayer(sketch, cueTimes));
    },
    /** Where the drawn answer's clock comes from: ms into its narration. */
    setAnswerClock(clock: () => number): void {
      answerClock = clock;
    },
    /** The board on screen while asking: the frozen board plus highlights, or the answer. */
    board(): BoardState {
      return askScene(frozen, layer, asking ? sinceOpen() : 0, answerClock());
    },
  };
}

/** The frozen board for a step at `tMs` (an empty board when no step is on screen). */
export function frozenBoard(
  step: {
    objects: readonly SceneObject[];
    timed: readonly TimedAction[];
  } | null,
  tMs: number,
): FrozenBoard {
  return step === null
    ? { objects: [], timed: [], pausedT: 0 }
    : { objects: step.objects, timed: step.timed, pausedT: tMs };
}
