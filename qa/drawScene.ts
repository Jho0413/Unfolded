// The `draw_scene` client tool (ARCHITECTURE.md section 8). It waits: the agent
// says one short line ("Let me sketch that."), calls the tool, and gets its
// result only once the sketch is on the board, or has failed, so it explains
// what the learner actually sees. The browser asks POST /api/sketch for the
// sketch. Every drawn answer goes on a clean board of its own, the Answer view
// (section 5.6), so the browser always asks for `fresh: true` with an empty
// board, whatever the agent passed. When the sketch arrives it's validated
// again and drawn, replacing any earlier drawing. A failure shows "Couldn't
// draw that." and the result tells the agent to answer in words. Only the
// latest request counts: whatever comes back for an older one (a sketch or a
// failure) is dropped.
import { SKETCH_FAILED, SketchResponse } from "@/shared/lesson";
import { EMPTY_BOARD, type BoardObject, type Sketch } from "@/shared/scene";
import { validateSketch } from "@/shared/validate";
import type { AskApi } from "./types";

/**
 * Longer than SK1's worst case: two attempts of config.sketch.timeoutMs
 * (20 s each, ARCHITECTURE.md section 8). A unit test checks it stays longer,
 * and agent/tool_configs/draw_scene.json waits a little longer still.
 */
export const SKETCH_FETCH_TIMEOUT_MS = 45_000;

export type DrawSceneDeps = {
  /** False once Ask has closed: a sketch arriving then is dropped. */
  isAsking: () => boolean;
  /**
   * Which Ask session this is (changes each time Ask opens), so a sketch
   * asked for in an earlier session is dropped even if Ask reopened.
   */
  askId: () => number;
  /**
   * Draws a validated sketch on an empty board, replacing any earlier drawing.
   * `description` is what the agent asked for, to tell it what's showing.
   */
  drawSketch: (sketch: Sketch, description: string) => void;
  /** The Ask panel's: a failure shows SKETCH_FAILED (a success clears it). */
  showNotice: AskApi["showNotice"];
  /** Injected in tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/** The tool's result when the sketch couldn't be drawn. */
export function sketchFailedUpdate(description: string): string {
  return `The sketch "${description}" couldn't be drawn. Answer in words instead, and don't describe it as drawn.`;
}

/** The tool's result when Ask closed, or a newer sketch was asked for, before this one came back. */
export const SKETCH_SUPERSEDED =
  "Not drawn: the learner moved on, or a newer sketch replaced it. Don't describe it.";

/** At most this many objects are listed back to the agent, to keep the result short. */
const LISTED_OBJECTS = 12;

/** One object as the learner sees it, in a few words (pure). */
function describeObject(o: BoardObject): string | null {
  switch (o.kind) {
    case "text":
      return `text "${o.text}"`;
    case "latex":
      return `formula ${o.tex}`;
    case "matrix": {
      const size = `${o.rows.length}×${o.rows[0]?.length ?? 0}`;
      const cells = o.rows.map((r) => r.join(" ")).join("; ");
      return `matrix${o.label ? ` "${o.label}"` : ""} (${size}: ${cells})`;
    }
    case "arrow":
      return o.label ? `arrow "${o.label}"` : null;
    default:
      return null;
  }
}

/**
 * The tool's result once the sketch is on the board (pure): what's drawn, so the agent
 * explains the picture the learner sees rather than the one it asked for.
 */
export function sketchDrawnResult(sketch: Sketch): string {
  const parts = sketch.objects
    .map(describeObject)
    .filter((s): s is string => s !== null)
    .slice(0, LISTED_OBJECTS);
  return `Drawn: the answer board now shows ${parts.join(", ")}. Explain it now, referring to what is drawn.`;
}

/**
 * Whether a request's result still counts (pure): its Ask session is the one open now, and
 * no newer request has started since. A newer drawing, or a newer request still in flight,
 * always wins over an older one, whichever comes back first.
 */
export function stillLatest(
  request: { askId: number; n: number },
  now: { asking: boolean; askId: number; newest: number },
): boolean {
  return now.asking && now.askId === request.askId && now.newest === request.n;
}

/**
 * The draw_scene handler for one Ask panel: each call starts a sketch request and resolves
 * with the tool's result once it is drawn, failed or superseded. The agent's `fresh` isn't
 * taken: a drawn answer always starts from a clean board.
 */
export function createDrawScene(
  deps: DrawSceneDeps,
): (description: string) => Promise<string> {
  let newest = 0;
  return (description) => {
    const request = { askId: deps.askId(), n: ++newest };
    const current = () =>
      stillLatest(request, {
        asking: deps.isAsking(),
        askId: deps.askId(),
        newest,
      });
    return requestSketch(deps, current, description).catch((err: unknown) =>
      fail(current, deps, description, String(err)),
    );
  };
}

async function requestSketch(
  deps: DrawSceneDeps,
  current: () => boolean,
  description: string,
): Promise<string> {
  const ctx = { board: EMPTY_BOARD, fresh: true };
  const doFetch = deps.fetch ?? fetch;
  const res = await doFetch("/api/sketch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, ...ctx }),
    signal: AbortSignal.timeout(deps.timeoutMs ?? SKETCH_FETCH_TIMEOUT_MS),
  });
  const body: unknown = await res.json().catch(() => null);
  // Ask closed, or a newer request started: not ours to draw.
  if (!current()) return SKETCH_SUPERSEDED;
  if (!res.ok) return fail(current, deps, description, `HTTP ${res.status}`);
  const parsed = SketchResponse.safeParse(body);
  if (!parsed.success) return fail(current, deps, description, "bad response");
  // Checked again in the browser, with the same rules as the route (section 4).
  const checked = validateSketch(parsed.data.sketch, ctx);
  // Spacing is soft: the route may send a sketch whose only problems are overlaps.
  if (!checked.ok && !checked.softOnly)
    return fail(current, deps, description, checked.errors.join("; "));
  const sketch = checked.ok ? checked.value : checked.softOnly!.value;
  deps.drawSketch(sketch, description);
  deps.showNotice(null);
  return sketchDrawnResult(sketch);
}

function fail(
  current: () => boolean,
  deps: DrawSceneDeps,
  description: string,
  reason: string,
): string {
  console.warn("[qa] draw_scene failed:", reason);
  if (!current()) return SKETCH_SUPERSEDED;
  deps.showNotice(SKETCH_FAILED);
  return sketchFailedUpdate(description);
}
