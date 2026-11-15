// Pure helpers behind usePlayer and the tutor card (ROADMAP P5, ARCHITECTURE.md
// section 5.6): which step is on screen, which events change the state (the card
// offers exactly those), how the browser's answers to audio.play() and key
// presses become machine events, what closing Ask carries on with, and the last
// cue for the debug overlay. No React, no audio element.
import type { CueTimes } from "@/shared/lesson";
import type { CuedAction } from "@/shared/scene";
import {
  type AskOrigin,
  type PlayerContext,
  type PlayerEvent,
  type PlayerState,
  transition,
} from "./machine";

/** The step whose board and audio are on screen (Ask shows the step it was opened from). */
export function stepOnScreen(state: PlayerState): number {
  return state.kind === "asking" ? state.from.step : state.step;
}

/**
 * Whether an event would change the player now. The machine is the one
 * source of truth: a control is enabled exactly when its event isn't
 * ignored, rejected or impossible in this state.
 */
export function canSend(
  state: PlayerState,
  event: PlayerEvent,
  ctx: PlayerContext,
): boolean {
  return transition(state, event, ctx).outcome === "changed";
}

/** Space, and the card's Hold on / Go on: pause while playing, otherwise resume. */
export function playPauseEvent(state: PlayerState): PlayerEvent {
  return state.kind === "playing" ? { type: "pause" } : { type: "resume" };
}

/**
 * The event for a rejected `audio.play()`. NotAllowedError is the browser
 * blocking autoplay. AbortError is a pause or a new source interrupting the
 * play, which is expected. Anything else is reported by the element's own
 * `error` event, so it isn't sent twice.
 */
export function playRejectionEvent(error: unknown): PlayerEvent | null {
  if (error instanceof DOMException && error.name === "NotAllowedError")
    return { type: "playBlocked" };
  return null;
}

/**
 * Whether a key press is the Space play/pause shortcut. Not with a modifier
 * (Shift+Space and friends belong to the browser), not on key repeat (so
 * holding Space doesn't flicker), and not on an interactive element: a text
 * field types the space, and Space already presses a focused button or link.
 */
export function isPlayPauseKey(key: {
  key: string;
  repeat: boolean;
  modified: boolean;
  target: { tagName: string; isContentEditable: boolean } | null;
}): boolean {
  if (key.key !== " " || key.repeat || key.modified) return false;
  if (key.target === null) return true;
  if (key.target.isContentEditable) return false;
  return !INTERACTIVE_TAGS.has(key.target.tagName.toUpperCase());
}

const INTERACTIVE_TAGS = new Set([
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "BUTTON",
  "A",
  "SUMMARY",
]);

/**
 * The last cue that fired by `tMs`: the latest cue time at or before it,
 * among the cues the step's actions use (a marker no action uses fires
 * nothing). Cues at the same time give the last one in action order.
 */
export function lastFiredCue(
  actions: readonly CuedAction[],
  cueTimes: CueTimes,
  tMs: number,
): string | null {
  let last: string | null = null;
  let lastMs = -Infinity;
  for (const { cue } of actions) {
    if (!Object.hasOwn(cueTimes, cue)) continue;
    const ms = cueTimes[cue];
    if (ms <= tMs && ms >= lastMs) {
      last = cue;
      lastMs = ms;
    }
  }
  return last;
}

/**
 * The tutor's other shortcuts (the outline's key hints): → next idea, ← back, R say that
 * again. Space is `isPlayPauseKey` and `A` is the Ask panel's. Not with a modifier, not on key
 * repeat, and not while typing in a text field (a focused button is fine: arrows and R don't
 * press it).
 */
export function shortcutEvent(key: {
  key: string;
  repeat: boolean;
  modified: boolean;
  target: { tagName: string; isContentEditable: boolean } | null;
}): PlayerEvent | null {
  if (key.repeat || key.modified || isTextEntry(key.target)) return null;
  switch (key.key) {
    case "ArrowRight":
      return { type: "next" };
    case "ArrowLeft":
      return { type: "back" };
    case "r":
    case "R":
      return { type: "replay" };
    default:
      return null;
  }
}

/**
 * Whether a key press lands in a text field (an input, textarea, select or contentEditable),
 * where letters and arrows are the learner's typing, not shortcuts. The Ask panel's `A` uses
 * it too.
 */
export function isTextEntry(
  target: { tagName: string; isContentEditable: boolean } | null,
): boolean {
  if (target === null) return false;
  return (
    target.isContentEditable || TEXT_TAGS.has(target.tagName.toUpperCase())
  );
}

const TEXT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * How Ask was closed: the card's "Got it, carry on", or a dismissal (Escape, or the agent
 * ending the session).
 */
export type AskClose = "carryOn" | "dismiss";

/**
 * The event after closeAsk (ARCHITECTURE.md section 5.6), from how Ask was closed, what it
 * was opened from, and where closeAsk left the player. Only a lesson closeAsk left paused
 * mid-step can go on:
 * - "Got it, carry on" always resumes it.
 * - A dismissal goes back to how it was before Ask: explaining resumes, held on stays held;
 *   a step that was loading to autoplay plays.
 * Anything else (an ended step's prompt, a go_to_step jump loading paused, a failure) stays
 * as closeAsk left it.
 */
export function afterAskEvent(
  how: AskClose,
  origin: AskOrigin,
  afterClose: PlayerState,
): PlayerEvent | null {
  if (afterClose.kind !== "paused") return null;
  const resume: PlayerEvent = { type: "resume" };
  if (how === "carryOn") return resume;
  if (origin.kind === "playing") return resume;
  if (origin.kind === "loading" && origin.autoplay) return resume;
  return null;
}

/** A spoken lesson command (issue #93): the agent's control tools (shared/tools.ts). */
export type LessonCommand = "resume" | "pause" | "next" | "previous" | "replay";

/**
 * The machine event for a spoken command, in the state the player is in once Ask is closed
 * (ARCHITECTURE.md section 8). Existing events only, so machine.ts doesn't change:
 * - resume: Go on from held on (`resume`).
 * - pause: hold on while explaining (`pause`).
 * - next: the end-of-step Next (`next`, or finished on the last step); mid-step, where the
 *   machine only takes Next after the step ends, a jump to the next step (`goToStep`, which
 *   starts at once); after a failed step, `next` skips it.
 * - previous: `back` (step 0 starts again).
 * - replay: `replay` (from the start of the step).
 * Null when the command means nothing now (e.g. next on the last step mid-step).
 */
export function commandEvent(
  command: LessonCommand,
  state: PlayerState,
  ctx: PlayerContext,
): PlayerEvent | null {
  const event = ((): PlayerEvent | null => {
    switch (command) {
      case "resume":
        return { type: "resume" };
      case "pause":
        return { type: "pause" };
      case "previous":
        return { type: "back" };
      case "replay":
        return { type: "replay" };
      case "next":
        if (state.kind === "playing" || state.kind === "paused")
          return state.step + 1 < ctx.stepCount
            ? { type: "goToStep", n: state.step + 1 }
            : null;
        return { type: "next" };
    }
  })();
  return event !== null && canSend(state, event, ctx) ? event : null;
}
