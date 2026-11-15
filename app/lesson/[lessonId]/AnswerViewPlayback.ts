// A narrated answer's playback (#105, ARCHITECTURE.md section 5.6): the Answer view plays a drawn
// answer like a lesson step, its drawing built up on its cues as its narration is spoken. Pure:
// the decisions only, one test per row in tests/unit/app/lesson/AnswerViewPlayback.test.ts;
// ./AnswerViewAudio.ts does what they say to the answer's audio element.
//
// Before an answer arrives (draw_scene in flight: the card's "Sketching…") and after Ask closes
// there is no playback at all; qa/drawScene.ts and ./boardView.ts own those rows.
import type { LessonCommand } from "@/player/controls";

/** Where a shown answer is: its narration playing, held by the learner speaking, or over. */
export type AnswerPlayback = "playing" | "paused" | "done";

export type AnswerEvent =
  /** The narration reached its end. */
  | "ended"
  /** The learner started speaking (barge-in): the narration stops where it is. */
  | "learnerSpoke"
  /** "Carry on" / "go on" while the answer is held. */
  | "resume"
  /** "Say that again": from the start, the drawing reset with it. */
  | "replay"
  /** The audio couldn't load or play: show the whole drawing instead. */
  | "audioFailed";

/**
 * Where the answer's clock goes: stays where it is, back to 0, or past the end (the whole
 * drawing, at once).
 */
export type AnswerClock = "here" | "start" | "end";

export type AnswerTransition = { to: AnswerPlayback; clock: AnswerClock };

/** The transition for an event, or null when the answer ignores it (pure). */
export function answerTransition(
  state: AnswerPlayback,
  event: AnswerEvent,
): AnswerTransition | null {
  switch (event) {
    case "ended":
      // Only a playing narration can end; a late "ended" after a pause or a replay is stale.
      return state === "playing" ? { to: "done", clock: "end" } : null;
    case "learnerSpoke":
      return state === "playing" ? { to: "paused", clock: "here" } : null;
    case "resume":
      return state === "paused" ? { to: "playing", clock: "here" } : null;
    case "replay":
      return { to: "playing", clock: "start" };
    case "audioFailed":
      // Degrade, don't fail: the drawing is shown complete.
      return state === "done" ? null : { to: "done", clock: "end" };
  }
}

/**
 * The answer's event for a spoken command while its Answer view is up, or null when the command
 * is the lesson's (it closes Ask as before, player/controls.ts). "Carry on" goes on with a held
 * answer; once it's over, it goes back to the lesson. "Say that again" replays the answer.
 */
export function answerCommand(
  state: AnswerPlayback | null,
  command: LessonCommand,
): AnswerEvent | null {
  if (state === null) return null;
  if (command === "resume") return state === "paused" ? "resume" : null;
  if (command === "replay") return "replay";
  return null;
}

/** How the first playback of an answer ended, for draw_scene's result to the agent. */
export type AnswerOutcome =
  /** Played to its end, or shown complete when the audio failed. */
  | { kind: "shown" }
  /** The learner spoke over it at `tMs` into its narration. */
  | { kind: "paused"; tMs: number }
  /** Ask closed, or a newer answer replaced it, before either. */
  | { kind: "left" };
