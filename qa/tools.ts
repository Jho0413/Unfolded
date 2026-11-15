// The Q&A agent's client tool handlers (ARCHITECTURE.md section 8), typed by
// shared/tools.ts and passed to the Ask panel's `tools` prop. qa/callTool.ts
// has already checked each call's parameters against shared/tools.ts.
//
//   highlight          checked against the board on screen; "ok" or the error
//                      (a no-op while the Answer view is up)
//   go_to_step         goToStep(step - 1); "ok" or "no step n". The step the lesson stopped on
//                      means back to where it stopped (the "Back to step N" chip), not a restart
//   simplify_upcoming  records a simplify signal for the next step (section 5.4); no wait
//   highlight_paper    highlights a passage in the paper beside the board; "ok: …" or why not
//   draw_scene         waits: resolves once the narrated answer has played ("Shown: …"), the
//                      learner spoke over it, or it failed or was superseded (qa/drawScene.ts)
//   resume_lesson, pause_lesson, next_step, previous_step, replay_step
//                      no wait: the learner's spoken commands (issue #93), run by `control`
//                      once the agent has finished speaking (`afterAgentSpeaks`)
import type { LessonCommand } from "@/player/controls";
import type { PlayerEvent, TransitionResult } from "@/player/machine";
import {
  type Action,
  type SceneObject,
  type BoardState,
  DEFAULT_DURATION_MS,
} from "@/shared/scene";
import { checkAction } from "@/shared/validate";
import { createDrawScene, type DrawSceneDeps } from "./drawScene";
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
   * Highlights a quote in the paper beside the board (the lesson page's useLessonPaper): what
   * goes back to the agent. Without it (no paper viewer, e.g. /dev/ask) the tool says so.
   */
  highlightPaper?: (quote: string, page?: number) => string;
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
  /**
   * The step the lesson stopped on for this Ask (0-based), and how to go back to it where it
   * stopped (the Answer view's "Back to step N" chip). With both, go_to_step to that step
   * returns there instead of loading the step again from its start.
   */
  stoppedStep?: () => number;
  backToLesson?: () => void;
  /**
   * Records simplify_upcoming's request for the next step (qa/askSignals.ts, section 5.4).
   * Without it (e.g. /dev/ask) the call is only logged.
   */
  simplifyUpcoming?: (reason: string) => void;
  /** A highlight landed on the board or the paper (AskApi.pointed, #91). Absent: not told. */
  pointed?: (at: "board" | "paper") => void;
  /** A control tool ran (AskApi.commanded, QA A8). Absent: not told. */
  commanded?: (command: LessonCommand) => void;
} & Pick<
  DrawSceneDeps,
  | "askId"
  | "lessonId"
  | "playAnswer"
  | "showNotice"
  | "sketching"
  | "fetch"
  | "fetchAudio"
  | "timeoutMs"
>;

/** What a tool that changes the board or the step returns after Ask closed. */
export const ASK_CLOSED = "Ask is closed";

/** What highlight_paper returns where the page has no paper viewer. */
export const NO_PAPER_VIEWER = "There is no document on screen.";

/** What `go_to_step` returns for the step the lesson stopped on. */
export const BACK_WHERE_STOPPED =
  "ok: back on the lesson where it stopped, paused. Say the learner can carry on when ready.";

/** What `highlight` returns while the Answer view is up. */
export const ANSWER_SHOWING =
  "The answer board is showing; the lesson isn't visible.";

export function createClientTools(deps: ClientToolDeps): QaTools {
  const drawScene = createDrawScene(deps);
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
      deps.pointed?.("board");
      return "ok";
    },
    // 1-based, as spoken. While asking, the machine remembers the step and
    // loads it paused once Ask closes (section 6.1).
    // A late call after Ask closed would start the narration at a new step.
    go_to_step: ({ step }) => {
      if (!deps.isAsking()) return ASK_CLOSED;
      // "Back to step N" for the step it stopped on: back where it stopped, not from the start.
      if (deps.backToLesson && deps.stoppedStep?.() === step - 1) {
        deps.backToLesson();
        return BACK_WHERE_STOPPED;
      }
      const result = deps.send({ type: "goToStep", n: step - 1 });
      return result.outcome === "rejected" ? result.message : "ok";
    },
    highlight_paper: ({ quote, page }) => {
      if (!deps.isAsking()) return ASK_CLOSED;
      const result = deps.highlightPaper?.(quote, page) ?? NO_PAPER_VIEWER;
      if (result.startsWith("ok")) deps.pointed?.("paper");
      return result;
    },
    // Waits until the sketch is drawn, so the agent explains what the learner sees.
    // Always a clean board of its own (the agent's `fresh` isn't taken), latest request only.
    draw_scene: ({ description }) => {
      if (!deps.isAsking()) return ASK_CLOSED;
      return drawScene(description);
    },
    resume_lesson: () => command(deps, "resume"),
    pause_lesson: () => command(deps, "pause"),
    next_step: () => command(deps, "next"),
    previous_step: () => command(deps, "previous"),
    replay_step: () => command(deps, "replay"),
    simplify_upcoming: ({ reason }) => {
      if (deps.simplifyUpcoming) deps.simplifyUpcoming(reason);
      else console.info("[qa] simplify_upcoming (nothing records it):", reason);
    },
  };
}

/** A control tool: no wait, so nothing goes back to the agent. */
function command(deps: ClientToolDeps, cmd: LessonCommand): void {
  const { control } = deps;
  if (control === undefined) return;
  deps.commanded?.(cmd);
  const later = deps.afterAgentSpeaks ?? ((fn: () => void) => fn());
  later(() => control(cmd));
}

/** Only objects the learner can see can be highlighted. */
function visibleObjects(board: BoardState): Map<string, SceneObject> {
  return new Map(
    board.objects.filter((s) => s.visible).map((s) => [s.object.id, s.object]),
  );
}
