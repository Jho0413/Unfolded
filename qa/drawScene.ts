// The `draw_scene` client tool (ARCHITECTURE.md section 8). It doesn't wait:
// the handler returns nothing at once, so the agent keeps talking while the
// browser asks POST /api/sketch for a sketch. Every drawn answer goes on a
// clean board of its own, the Answer view (section 5.6), so the browser always
// asks for `fresh: true` with an empty board, whatever the agent passed. When
// the sketch arrives it's validated again and drawn, replacing any earlier
// drawing, timed from arrival. A failure shows "Couldn't draw that." and tells
// the agent, so it answers in words.
import { SKETCH_FAILED, SketchResponse } from "@/shared/lesson";
import type { BoardState, Sketch } from "@/shared/scene";
import { validateSketch } from "@/shared/validate";
import type { AskApi } from "./types";

/**
 * Longer than SK1's worst case: two attempts of config.sketch.timeoutMs
 * (20 s each, ARCHITECTURE.md section 8). A unit test checks it stays longer.
 */
export const SKETCH_FETCH_TIMEOUT_MS = 45_000;

/** A drawn answer starts from an empty board. */
const EMPTY_BOARD: BoardState = { objects: [], copies: [], active: [] };

export type DrawSceneDeps = {
  /** False once Ask has closed: a sketch arriving then is dropped. */
  isAsking: () => boolean;
  /**
   * Which Ask session this is (changes each time Ask opens), so a sketch
   * asked for in an earlier session is dropped even if Ask reopened.
   */
  askId: () => number;
  /**
   * Draws a validated sketch; `fresh` (always true here) means on an empty board, replacing
   * any earlier drawing. `description` is what the agent asked for, to tell it what's showing.
   */
  drawSketch: (sketch: Sketch, fresh: boolean, description: string) => void;
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

/**
 * Starts the sketch request and returns at once (the tool's result is nothing). The agent's
 * `fresh` isn't taken: a drawn answer always starts from a clean board.
 */
export function drawScene(
  deps: DrawSceneDeps,
  description: string,
): Promise<void> {
  const askId = deps.askId();
  // Still the session that asked for this sketch?
  const current = () => deps.isAsking() && deps.askId() === askId;
  return requestSketch(deps, current, description).catch((err: unknown) =>
    fail(current, deps, description, String(err)),
  );
}

async function requestSketch(
  deps: DrawSceneDeps,
  current: () => boolean,
  description: string,
): Promise<void> {
  const ctx = { board: EMPTY_BOARD, fresh: true };
  const doFetch = deps.fetch ?? fetch;
  const res = await doFetch("/api/sketch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, ...ctx }),
    signal: AbortSignal.timeout(deps.timeoutMs ?? SKETCH_FETCH_TIMEOUT_MS),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!current()) return; // Ask closed meanwhile: nothing to draw on
  if (!res.ok) return fail(current, deps, description, `HTTP ${res.status}`);
  const parsed = SketchResponse.safeParse(body);
  if (!parsed.success) return fail(current, deps, description, "bad response");
  // Checked again in the browser, with the same rules as the route (section 4).
  const checked = validateSketch(parsed.data.sketch, ctx);
  if (!checked.ok)
    return fail(current, deps, description, checked.errors.join("; "));
  deps.drawSketch(checked.value, ctx.fresh, description);
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
