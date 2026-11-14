// The `draw_scene` client tool (ARCHITECTURE.md section 8). It doesn't wait:
// the handler returns nothing at once, so the agent keeps talking while the
// browser asks POST /api/sketch for a sketch of the board on screen. When the
// sketch arrives it's validated again against the board as it is then (the
// board may have changed meanwhile) and drawn on top, timed from arrival. A
// failure shows "Couldn't draw that." and tells the agent, so it answers in
// words.
import { SKETCH_FAILED, SketchResponse } from "@/shared/lesson";
import type { BoardState, Sketch } from "@/shared/scene";
import { validateSketch } from "@/shared/validate";
import type { AskApi } from "./types";

/**
 * Mirrors config.maxBoardObjects (lib/config.ts is server-only); a unit test
 * keeps them equal.
 */
export const MAX_BOARD_OBJECTS = 200;

/**
 * Longer than SK1's worst case: two attempts of config.sketch.timeoutMs
 * (20 s each, ARCHITECTURE.md section 8). A unit test checks it stays longer.
 */
export const SKETCH_FETCH_TIMEOUT_MS = 45_000;

export type DrawSceneDeps = {
  /** The board on screen now (after a fresh sketch, that fresh board). */
  board: () => BoardState;
  /** False once Ask has closed: a sketch arriving then is dropped. */
  isAsking: () => boolean;
  /**
   * Which Ask session this is (changes each time Ask opens), so a sketch
   * asked for in an earlier session is dropped even if Ask reopened.
   */
  askId: () => number;
  /** Draws a validated sketch on top of the board, or on an empty one. */
  drawSketch: (sketch: Sketch, fresh: boolean) => void;
  /** The Ask panel's: a failure shows SKETCH_FAILED (a success clears it). */
  showNotice: AskApi["showNotice"];
  /** The Ask panel's: a failure tells the agent to answer in words. */
  tellAgent: AskApi["tellAgent"];
  /** Injected in tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/** What the agent is told when a sketch fails. */
export function sketchFailedUpdate(description: string): string {
  return `The sketch "${description}" couldn't be drawn. Answer in words instead, and don't describe it as drawn.`;
}

/** Starts the sketch request and returns at once (the tool's result is nothing). */
export function drawScene(
  deps: DrawSceneDeps,
  description: string,
  fresh: boolean,
): Promise<void> {
  const askId = deps.askId();
  // Still the session that asked for this sketch?
  const current = () => deps.isAsking() && deps.askId() === askId;
  return requestSketch(deps, current, description, fresh).catch(
    (err: unknown) => fail(current, deps, description, String(err)),
  );
}

async function requestSketch(
  deps: DrawSceneDeps,
  current: () => boolean,
  description: string,
  fresh: boolean,
): Promise<void> {
  const board = boardToSend(deps.board(), fresh);
  if (board === null) {
    return fail(current, deps, description, "board over MAX_BOARD_OBJECTS");
  }
  const doFetch = deps.fetch ?? fetch;
  const res = await doFetch("/api/sketch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, fresh, board }),
    signal: AbortSignal.timeout(deps.timeoutMs ?? SKETCH_FETCH_TIMEOUT_MS),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!current()) return; // Ask closed meanwhile: nothing to draw on
  if (!res.ok) return fail(current, deps, description, `HTTP ${res.status}`);
  const parsed = SketchResponse.safeParse(body);
  if (!parsed.success) return fail(current, deps, description, "bad response");
  const checked = validateSketch(parsed.data.sketch, {
    board: deps.board(),
    fresh,
  });
  if (!checked.ok)
    return fail(current, deps, description, checked.errors.join("; "));
  deps.drawSketch(checked.value, fresh);
  deps.showNotice(null);
}

function fail(
  current: () => boolean,
  deps: DrawSceneDeps,
  description: string,
  reason: string,
): void {
  console.warn("[qa] draw_scene failed:", reason);
  if (!current()) return;
  deps.showNotice(SKETCH_FAILED);
  deps.tellAgent(sketchFailedUpdate(description));
}

/**
 * The board to send, within the route's cap: an empty one for a fresh sketch,
 * else the board, without hidden objects if it's over the cap. Null when even
 * the visible objects are too many.
 */
export function boardToSend(
  board: BoardState,
  fresh: boolean,
): BoardState | null {
  if (fresh) return { objects: [], copies: [], active: [] };
  if (board.objects.length <= MAX_BOARD_OBJECTS) return board;
  const visible = board.objects.filter((s) => s.visible);
  return visible.length <= MAX_BOARD_OBJECTS
    ? { ...board, objects: visible }
    : null;
}
