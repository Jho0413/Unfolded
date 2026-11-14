// Pure helpers behind usePlayer and the player controls (ROADMAP P5): which
// step is on screen, which controls do something, how the browser's answers
// to audio.play() and key presses become machine events, and the last cue
// for the debug overlay. No React, no audio element.
import type { CueTimes } from "@/shared/lesson";
import type { CuedAction } from "@/shared/scene";
import {
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

/** The Play/Pause control (and Space): pause while playing, otherwise play. */
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
  if (key.repeat || key.modified) return null;
  if (key.target?.isContentEditable) return null;
  if (key.target && TEXT_TAGS.has(key.target.tagName.toUpperCase()))
    return null;
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

const TEXT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * "Got it, carry on": after closeAsk, the event that carries on. A lesson stopped mid-step
 * (closeAsk returns to paused) resumes; any other state (an ended step, a step still loading,
 * a failed one) stays as closeAsk left it.
 */
export function carryOnEvent(afterClose: PlayerState): PlayerEvent | null {
  return afterClose.kind === "paused" ? { type: "resume" } : null;
}
