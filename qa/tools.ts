// The Q&A agent's client tool handlers (ARCHITECTURE.md section 8), typed by
// shared/tools.ts and passed to the Ask panel's `tools` prop. qa/callTool.ts
// has already checked each call's parameters against shared/tools.ts.
//
//   highlight          checked against the board on screen; "ok" or the error
//                      (a no-op while the Answer view is up)
//   go_to_step         goToStep(step - 1); "ok" or "no step n"
//   simplify_upcoming  stub until A1 (returns nothing)
//   draw_scene         no wait: returns nothing, the sketch is drawn when it arrives (qa/drawScene.ts)
//   resume_lesson, pause_lesson, next_step, previous_step, replay_step
//                      no wait: the learner's spoken commands (issue #93), run by `control`
//                      once the agent has finished speaking (`afterAgentSpeaks`)
import type { LessonCommand } from "@/player/controls";
import type { PlayerEvent, TransitionResult } from "@/player/machine";
import {
  type Action,
  type BoardObject,
  type BoardState,
  DEFAULT_DURATION_MS,
} from "@/shared/scene";
import { checkAction } from "@/shared/validate";
import { type DrawSceneDeps, drawScene } from "./drawScene";
import type { QaTools } from "./types";

export type HighlightAction = Extract<Action, { do: "highlight" }>;

export type ClientToolDeps = {
  /** The board the learner sees now: the frozen lesson board plus Q&A drawings. */
  board: () => BoardState;
  /** Draws a valid highlight on top of that board (thrown away when Ask closes). */
  highlight: (action: HighlightAction) => void;
  /** Sends an event to the player machine and returns its result, synchronously. */
  send: (event: PlayerEvent) => TransitionResult;
  /** True while the player is `asking`. A tool call can land after Ask closed. */
  isAsking: () => boolean;
  /**
   * Carries out a spoken lesson command (closing Ask first if it's open). Without it the
   * control tools do nothing (e.g. /dev/ask, which has no lesson).
   */
  control?: (command: LessonCommand) => void;
  /**
   * Runs `fn` once the agent has finished speaking, so the narration never starts over it
   * (AskApi.afterAgentSpeaks). Defaults to at once.
   */
  afterAgentSpeaks?: (fn: () => void) => void;
  /**
   * True while a drawn answer is on screen instead of the lesson (the Answer view, section
   * 5.6): `highlight` has nothing to point at. Absent: never.
   */
  answerShowing?: () => boolean;
} & Pick<
  DrawSceneDeps,
  "askId" | "drawSketch" | "showNotice" | "tellAgent" | "fetch" | "timeoutMs"
>;

/** What a tool that changes the board or the step returns after Ask closed. */
export const ASK_CLOSED = "Ask is closed";

/** What `highlight` returns while the Answer view is up. */
export const ANSWER_SHOWING =
  "The answer board is showing; the lesson isn't visible.";

export function createClientTools(deps: ClientToolDeps): QaTools {
  return {
    highlight: ({ target_id, row, col }) => {
      if (!deps.isAsking()) return ASK_CLOSED;
      // A no-op while a drawn answer hides the lesson (section 5.6).
      if (deps.answerShowing?.()) return ANSWER_SHOWING;
      const action: HighlightAction = {
        do: "highlight",
        target: { id: target_id, row, col },
        durationMs: DEFAULT_DURATION_MS,
      };
      const errors = checkAction(action, visibleObjects(deps.board()));
      if (errors.length > 0) return errors.join("; ");
      deps.highlight(action);
      return "ok";
    },
    // 1-based, as spoken. While asking, the machine remembers the step and
    // loads it paused once Ask closes (section 6.1).
    // A late call after Ask closed would start the narration at a new step.
    go_to_step: ({ step }) => {
      if (!deps.isAsking()) return ASK_CLOSED;
      const result = deps.send({ type: "goToStep", n: step - 1 });
      return result.outcome === "rejected" ? result.message : "ok";
    },
    // Doesn't wait: the agent keeps talking while the sketch is made.
    // Always a clean board of its own (drawScene ignores the agent's `fresh`).
    draw_scene: ({ description }) => {
      if (!deps.isAsking()) return;
      void drawScene(deps, description);
    },
    resume_lesson: () => command(deps, "resume"),
    pause_lesson: () => command(deps, "pause"),
    next_step: () => command(deps, "next"),
    previous_step: () => command(deps, "previous"),
    replay_step: () => command(deps, "replay"),
    // A1 replaces this with a signal to the server (section 5.4).
    simplify_upcoming: ({ reason }) => {
      console.info("[qa] simplify_upcoming (not built yet):", reason);
    },
  };
}

/** A control tool: no wait, so nothing goes back to the agent. */
function command(deps: ClientToolDeps, cmd: LessonCommand): void {
  const { control } = deps;
  if (control === undefined) return;
  const later = deps.afterAgentSpeaks ?? ((fn: () => void) => fn());
  later(() => control(cmd));
}

/** Only objects the learner can see can be highlighted. */
function visibleObjects(board: BoardState): Map<string, BoardObject> {
  return new Map(
    board.objects.filter((s) => s.visible).map((s) => [s.object.id, s.object]),
  );
}
