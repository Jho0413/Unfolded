// When a step's "try it yourself" widget is on screen (issue #110). Pure, from the player's
// state alone: the widget belongs to the end of a step, so it shows once the narration has
// ended (stepEnded, or finished after the last step), and stays while Ask is open over that
// end. Replaying the step (playing again), Next and go_to_step (loading) take it away.
import type { PlayerState } from "@/player/machine";
import type { Step } from "@/shared/scene";
import type { Widget } from "@/shared/widget";

/** Whether the player is at the end of its step: where a widget shows. */
export function atStepEnd(state: PlayerState): boolean {
  switch (state.kind) {
    case "stepEnded":
    case "finished":
      return true;
    case "asking":
      return state.from.kind === "stepEnded" || state.from.kind === "finished";
    default:
      return false;
  }
}

/** The widget to show now: the loaded step's, at its end; otherwise none. */
export function widgetOnScreen(
  state: PlayerState,
  step: Step | undefined,
): Widget | null {
  return atStepEnd(state) ? (step?.widget ?? null) : null;
}
