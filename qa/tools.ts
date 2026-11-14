// The Q&A agent's client tool handlers (ARCHITECTURE.md section 8), typed by
// shared/tools.ts and passed to the Ask panel's `tools` prop. qa/callTool.ts
// has already checked each call's parameters against shared/tools.ts.
//
//   highlight          checked against the board on screen; "ok" or the error
//   go_to_step         goToStep(step - 1); "ok" or "no step n"
//   simplify_upcoming  stub until A1 (returns nothing)
//   draw_scene         Q5: not handled yet, so the agent is told it isn't available
import type { PlayerEvent, TransitionResult } from "@/player/machine";
import {
  type Action,
  type BoardObject,
  type BoardState,
  DEFAULT_DURATION_MS,
} from "@/shared/scene";
import { checkAction } from "@/shared/validate";
import type { QaTools } from "./types";

export type HighlightAction = Extract<Action, { do: "highlight" }>;

export type ClientToolDeps = {
  /** The board the learner sees now: the frozen lesson board plus Q&A drawings. */
  board: () => BoardState;
  /** Draws a valid highlight on top of that board (thrown away when Ask closes). */
  highlight: (action: HighlightAction) => void;
  /** Sends an event to the player machine and returns its result, synchronously. */
  send: (event: PlayerEvent) => TransitionResult;
};

export function createClientTools(deps: ClientToolDeps): QaTools {
  return {
    highlight: ({ target_id, row, col }) => {
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
    go_to_step: ({ step }) => {
      const result = deps.send({ type: "goToStep", n: step - 1 });
      return result.outcome === "rejected" ? result.message : "ok";
    },
    // A1 replaces this with a signal to the server (section 5.4).
    simplify_upcoming: ({ reason }) => {
      console.info("[qa] simplify_upcoming (not built yet):", reason);
    },
  };
}

/** Only objects the learner can see can be highlighted. */
function visibleObjects(board: BoardState): Map<string, BoardObject> {
  return new Map(
    board.objects.filter((s) => s.visible).map((s) => [s.object.id, s.object]),
  );
}
