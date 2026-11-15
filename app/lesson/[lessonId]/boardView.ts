// The Answer view (ARCHITECTURE.md section 5.6): a drawn answer shows on a clean board of its
// own, instead of the lesson, on the same stage. Pure. It is never its own state: it exists
// exactly while the player is `asking` and the Ask layer holds a drawing (draw_scene always
// draws fresh, so a drawing replaces the lesson and any earlier drawing). Leaving `asking`
// (closeAsk) throws the layer away, so the lesson board comes back exactly as it was.
import { type AskClose, afterAskEvent } from "@/player/controls";
import type { AskOrigin, PlayerEvent, PlayerState } from "@/player/machine";
import type { AskLayer } from "@/qa/askBoard";

/** The Answer view's words. */
export const ANSWER_VIEW_TEXT = {
  tag: "Answer",
  back: (step: number) => `Back to step ${step}`,
} as const;

/** What the stage shows: the lesson board (with Ask's highlights), or a drawn answer. */
export type BoardView = "lesson" | "answer";

/** The view for whether the player is asking and what Ask has drawn. */
export function boardView(
  asking: boolean,
  layer: Pick<AskLayer, "fresh" | "objects">,
): BoardView {
  return asking && layer.fresh && layer.objects.length > 0
    ? "answer"
    : "lesson";
}

/**
 * How the learner leaves Ask: the card's "Got it, carry on", a dismissal (Escape, or the
 * agent ending the session), or the Answer view's "Back to step N" chip.
 */
export type LeaveAsk = AskClose | "back";

/**
 * The event after closeAsk. From the lesson, as player/controls.ts afterAskEvent decides.
 * From the Answer view, only "Got it, carry on" goes on: the chip and Escape return to the
 * lesson paused where the learner was, so they can look at it again before going on.
 */
export function afterLeavingAsk(
  how: LeaveAsk,
  view: BoardView,
  origin: AskOrigin,
  afterClose: PlayerState,
): PlayerEvent | null {
  if (how === "back") return null;
  if (view === "answer" && how === "dismiss") return null;
  return afterAskEvent(how, origin, afterClose);
}
