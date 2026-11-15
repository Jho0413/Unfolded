// The `draw_scene` client tool (ARCHITECTURE.md section 8). It waits: the agent
// says one short line ("Let me show you."), calls the tool, and stays quiet
// while the answer plays. The browser asks POST /api/sketch for a narrated
// answer (#105): a sketch with a narration, its audio and its cue times. Every
// drawn answer goes on a clean board of its own, the Answer view (section 5.6),
// so the browser always asks for `fresh: true` with an empty board, whatever
// the agent passed. Meanwhile the card says "Sketching…". When the answer
// arrives it's validated again, its audio downloaded, and it plays like a
// lesson step, replacing any earlier drawing; the tool resolves when the
// narration ends ("Shown: <narration>"), or when the learner speaks over it. A
// failure shows "Couldn't draw that." and the result tells the agent to answer
// in words. Only the latest request counts: whatever comes back for an older
// one (an answer or a failure) is dropped.
import { fetchAudioBlob } from "@/player/stepLoader";
import { SKETCH_FAILED, SketchResponse } from "@/shared/lesson";
import { EMPTY_BOARD } from "@/shared/scene";
import { parseNarration, validateSketch } from "@/shared/validate";
import { narrationUpTo } from "./context";
import type { AskApi } from "./types";

/**
 * Longer than the route's worst case: two attempts of config.sketch.timeoutMs (20 s each,
 * ARCHITECTURE.md section 8) plus voicing the narration (config.tts.timeoutMs). A unit test
 * checks it stays longer, and agent/tool_configs/draw_scene.json waits longer still, for the
 * narration to play too.
 */
export const SKETCH_FETCH_TIMEOUT_MS = 75_000;

/** A narrated answer as it arrives: the route's response, validated, with its audio. */
export type ArrivedAnswer = SketchResponse & {
  /** The narration's audio, or null when it failed to download (it shows whole, at once). */
  audio: Blob | null;
};

/** How an answer's first playback ended (app/lesson/[lessonId]/AnswerViewPlayback.ts). */
export type PlayedOutcome =
  { kind: "shown" } | { kind: "paused"; tMs: number } | { kind: "left" };

export type DrawSceneDeps = {
  /** False once Ask has closed: a sketch arriving then is dropped. */
  isAsking: () => boolean;
  /**
   * Which Ask session this is (changes each time Ask opens), so a sketch
   * asked for in an earlier session is dropped even if Ask reopened.
   */
  askId: () => number;
  /** The lesson whose run folder keeps the answer's audio. */
  lessonId: string;
  /**
   * Shows a validated answer on an empty board, replacing any earlier drawing, and plays it.
   * Resolves with how its first playback ended. `description` is what the agent asked for, to
   * tell it what's showing.
   */
  playAnswer: (
    answer: ArrivedAnswer,
    description: string,
  ) => Promise<PlayedOutcome>;
  /** The Ask panel's: a failure shows SKETCH_FAILED (a success clears it). */
  showNotice: AskApi["showNotice"];
  /** The Ask panel's: the card says "Sketching…" while the latest request is in flight. */
  sketching?: AskApi["sketching"];
  /** Injected in tests. */
  fetch?: typeof fetch;
  fetchAudio?: (url: string) => Promise<Blob>;
  timeoutMs?: number;
};

/** The tool's result when the sketch couldn't be drawn. */
export function sketchFailedUpdate(description: string): string {
  return `The sketch "${description}" couldn't be drawn. Answer in words instead, and don't describe it as drawn.`;
}

/** The tool's result when Ask closed, or a newer sketch was asked for, before this one came back. */
export const SKETCH_SUPERSEDED =
  "Not drawn: the learner moved on, or a newer sketch replaced it. Don't describe it.";

/** The tool's result once the narrated answer has played (or been shown whole): what was said. */
export function answerShownResult(narration: string): string {
  return `Shown: ${parseNarration(narration).spoken}`;
}

/** The tool's result when the learner spoke over the answer: what they had heard by then. */
export function answerPausedResult(
  narration: string,
  cueTimes: SketchResponse["cueTimes"],
  tMs: number,
): string {
  const heard = narrationUpTo(narration, cueTimes, tMs).trim();
  return `Paused after: ${heard === "" ? "(nothing yet)" : `${heard}…`}`;
}

/** The tool's result when the learner left the answer (Ask closed, or a newer one replaced it). */
export const ANSWER_LEFT =
  "The learner left this answer before it finished. Don't describe it.";

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
 * with the tool's result once the answer has played, failed or been superseded. The agent's
 * `fresh` isn't taken: a drawn answer always starts from a clean board.
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
    deps.sketching?.(true);
    // Only the latest request turns "Sketching…" off: a newer one is still in flight.
    const settled = () => {
      if (current()) deps.sketching?.(false);
    };
    return requestSketch(deps, current, settled, description).catch(
      (err: unknown) => {
        settled();
        return fail(current, deps, description, String(err));
      },
    );
  };
}

async function requestSketch(
  deps: DrawSceneDeps,
  current: () => boolean,
  settled: () => void,
  description: string,
): Promise<string> {
  const ctx = { board: EMPTY_BOARD, fresh: true };
  const doFetch = deps.fetch ?? fetch;
  const res = await doFetch("/api/sketch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, ...ctx, lessonId: deps.lessonId }),
    signal: AbortSignal.timeout(deps.timeoutMs ?? SKETCH_FETCH_TIMEOUT_MS),
  });
  const body: unknown = await res.json().catch(() => null);
  // Ask closed, or a newer request started: not ours to draw.
  if (!current()) return SKETCH_SUPERSEDED;
  if (!res.ok) {
    settled();
    return fail(current, deps, description, `HTTP ${res.status}`);
  }
  const parsed = SketchResponse.safeParse(body);
  if (!parsed.success) {
    settled();
    return fail(current, deps, description, "bad response");
  }
  // Checked again in the browser, with the same rules as the route (section 4).
  const checked = validateSketch(parsed.data.sketch, ctx);
  // Spacing is soft: the route may send a sketch whose only problems are overlaps.
  if (!checked.ok && !checked.softOnly) {
    settled();
    return fail(current, deps, description, checked.errors.join("; "));
  }
  const sketch = checked.ok ? checked.value : checked.softOnly!.value;
  // The audio, as the player downloads a step's. Failing to load it degrades, not fails: the
  // answer then shows whole, at once.
  const audio = await (deps.fetchAudio ?? fetchAudioBlob)(
    parsed.data.audioUrl,
  ).catch((err: unknown) => {
    console.warn("[qa] draw_scene: the answer's audio failed to load:", err);
    return null;
  });
  if (!current()) return SKETCH_SUPERSEDED;
  settled();
  deps.showNotice(null);
  const { cueTimes } = parsed.data;
  const outcome = await deps.playAnswer(
    { ...parsed.data, sketch, audio },
    description,
  );
  switch (outcome.kind) {
    case "shown":
      return answerShownResult(sketch.narration);
    case "paused":
      return answerPausedResult(sketch.narration, cueTimes, outcome.tMs);
    case "left":
      return ANSWER_LEFT;
  }
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
