// How the board's objects arrive (issue #101): strokes draw themselves on, text and formulas
// rise and fade in, cells fill in one after another, and a new highlight pulses once and
// settles. Every effect is computed from an in-progress action's `progress` in
// `BoardState.active` (sceneAt), so it is a pure function of the clock: a seek to any t shows
// the exact frame, a draw-on half done included. No CSS animation runs on its own clock.
//
// The `data-*` attributes the primitives set (data-opacity, data-highlight-opacity, ...) stay
// the actions' logical progress; these curves only change what is drawn.
//
// With prefers-reduced-motion there is no draw-on, rise, stagger or pulse: things just fade in
// over the first quarter of their action.
import { createContext, useContext, useSyncExternalStore } from "react";
import type { ActiveAction, Target } from "@/shared/scene";
import { partKey } from "@/player/sceneAt";
import { easeOutCubic, span } from "@/player/easing";
import { fadeOpacity } from "./style";
import "./board.css";

/** How far below its place text starts rising from (px). */
export const RISE_PX = 10;
/** With reduced motion, a fade completes in this share of its action. */
export const QUICK_FADE = 0.25;
/** A stroke's ink reaches full opacity in this share of the draw (the pen is visible at once). */
const INK_IN = 0.2;

/** Progress of the in-progress `show` of `target`, unless a `hide` of it is in progress too. */
export function showProgress(
  active: readonly ActiveAction[],
  target: Target,
): number | undefined {
  const key = partKey(target);
  let show: number | undefined;
  for (const { action, progress } of active) {
    if (partKey(action.target) !== key) continue;
    if (action.do === "hide") return undefined; // a crossfade: fadeOpacity handles it
    if (action.do === "show") show = progress;
  }
  return show;
}

export interface Appearance {
  /** The opacity to draw the object with. */
  opacity: number;
  /** How much of its strokes is drawn, 0..1 (1: all; with reduced motion, always 1). */
  draw: number;
  /** Its entrance progress, 0..1, for staggering its parts (cells). */
  enter: number;
  /** How far below its place it is drawn (px), rising to 0. */
  rise: number;
}

/**
 * How an object is drawn now. `stroke` objects (matrices, arrows) draw on: their ink is
 * visible almost at once and the pen travels with the `show`'s eased progress. `text` objects
 * (text, formulas) rise and fade in. Outside a `show`, it is `fadeOpacity` (a hide fades out).
 */
export function appearance(
  active: readonly ActiveAction[],
  target: Target,
  visible: boolean,
  kind: "stroke" | "text",
  reduced: boolean,
): Appearance {
  if (!visible) return { opacity: 0, draw: 1, enter: 1, rise: 0 };
  const show = showProgress(active, target);
  if (show === undefined)
    return { opacity: fadeOpacity(active, target), draw: 1, enter: 1, rise: 0 };
  if (reduced) return { opacity: quickFade(show), draw: 1, enter: 1, rise: 0 };
  const eased = easeOutCubic(show);
  return kind === "stroke"
    ? {
        opacity: easeOutCubic(span(show, 0, INK_IN)),
        draw: eased,
        enter: show,
        rise: 0,
      }
    : { opacity: eased, draw: 1, enter: show, rise: (1 - eased) * RISE_PX };
}

/** A fade done in the first QUICK_FADE of its progress (reduced motion). */
export function quickFade(p: number): number {
  return span(p, 0, QUICK_FADE);
}

/**
 * SVG attributes that draw a path on to `draw` (0..1) of its length. `pathLength={1}` makes the
 * length 1 whatever the geometry (the same as dashing by getTotalLength(), with no DOM read), so
 * the dash is exact at any t. Fully drawn: no dash at all.
 */
export function drawOnProps(draw: number): {
  pathLength?: number;
  strokeDasharray?: string;
  strokeDashoffset?: number;
} {
  if (draw >= 1) return {};
  return { pathLength: 1, strokeDasharray: "1 1", strokeDashoffset: 1 - draw };
}

/**
 * Opacity of part `i` of `n` (a matrix's cells, in reading order) while its object enters:
 * they fill in one after another behind the pen. 1 when not entering, or with reduced motion.
 */
export function staggerIn(
  enter: number,
  i: number,
  n: number,
  reduced: boolean,
): number {
  if (reduced || enter >= 1) return 1;
  const start = 0.2 + (n > 1 ? (0.45 * i) / (n - 1) : 0);
  return easeOutCubic(span(enter, start, 0.35));
}

export interface HighlightLook {
  /** Opacity of the highlight's fill and border. */
  opacity: number;
  /** The once-only pulse ring: 0 (none) up to 1 at the middle of the highlight, back to 0. */
  pulse: number;
}

/**
 * A highlight being set (`progress`, from cellProgress / objectProgress) fades in eased and
 * pulses once, peaking halfway and settling by the end. Reduced motion: a quick fade, no pulse.
 */
export function highlightLook(
  progress: number,
  reduced: boolean,
): HighlightLook {
  if (reduced) return { opacity: quickFade(progress), pulse: 0 };
  if (progress >= 1) return { opacity: 1, pulse: 0 };
  return {
    opacity: easeOutCubic(progress),
    pulse: Math.sin(Math.PI * Math.max(0, progress)),
  };
}

/** A written value fading in (a cell or a text's new value). */
export function writeOpacity(progress: number, reduced: boolean): number {
  return reduced ? quickFade(progress) : easeOutCubic(progress);
}

/** Rounded for `data-draw`, so tests compare stable strings. */
export function drawAttr(draw: number): string {
  return String(Math.round(draw * 100) / 100);
}

// ---------------------------------------------------------------- reduced motion

/**
 * Overrides the reduced-motion preference for a subtree (tests, a print view). Unset (null),
 * the board follows the browser's prefers-reduced-motion.
 */
export const ReducedMotion = createContext<boolean | null>(null);

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function prefersReduced(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.(QUERY).matches;
}

/** Whether the board should keep motion to quick fades. */
export function useReducedMotion(): boolean {
  const override = useContext(ReducedMotion);
  const media = useSyncExternalStore(subscribe, prefersReduced, () => false);
  return override ?? media;
}
