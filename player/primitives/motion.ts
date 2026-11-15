// How the board's objects arrive (issue #101): strokes draw themselves on, text and formulas
// rise and fade in, cells fill in one after another, and a new highlight pulses once and
// settles. Every effect is computed from an in-progress action's `progress` in
// `BoardState.active` (sceneAt), so it is a pure function of the clock: a seek to any t shows
// the exact frame, a draw-on half done included. No CSS animation runs on its own clock.
//
// The `data-*` attributes the primitives set (data-opacity, data-highlight-opacity, ...) stay
// the actions' logical progress; these curves only change what is drawn.
//
// prefers-reduced-motion is CSS only (./board.css), so the board stays a plain render with no
// React state (it is also rendered by a server component): what is moving carries a class
// (wb-draw, wb-rise, wb-pulse, wb-stagger) that the media query switches off, and what is
// fading in carries `wb-quick` with `--wb-quick`, its fade done in the first QUICK_FADE of its
// action, which the media query applies instead.
import type { CSSProperties } from "react";
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

/** A fade done in the first QUICK_FADE of its progress (what reduced motion shows). */
export function quickFade(p: number): number {
  return span(p, 0, QUICK_FADE);
}

export interface Appearance {
  /** The opacity to draw the object with. */
  opacity: number;
  /** How much of its strokes is drawn, 0..1 (1: all). */
  draw: number;
  /** Its entrance progress, 0..1, for staggering its parts (cells). */
  enter: number;
  /** How far below its place it is drawn (px), rising to 0. */
  rise: number;
  /** While it is being shown: its opacity with reduced motion. */
  quick?: number;
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
): Appearance {
  if (!visible) return { opacity: 0, draw: 1, enter: 1, rise: 0 };
  const show = showProgress(active, target);
  if (show === undefined)
    return { opacity: fadeOpacity(active, target), draw: 1, enter: 1, rise: 0 };
  const eased = easeOutCubic(show);
  const quick = quickFade(show);
  return kind === "stroke"
    ? {
        opacity: easeOutCubic(span(show, 0, INK_IN)),
        draw: eased,
        enter: show,
        rise: 0,
        quick,
      }
    : {
        opacity: eased,
        draw: 1,
        enter: show,
        rise: (1 - eased) * RISE_PX,
        quick,
      };
}

/**
 * SVG attributes that draw a path on to `draw` (0..1) of its length. `pathLength={1}` makes the
 * length 1 whatever the geometry (the same as dashing by getTotalLength(), with no DOM read), so
 * the dash is exact at any t. Fully drawn: no dash at all.
 */
export function drawOnProps(draw: number): {
  className?: string;
  pathLength?: number;
  strokeDasharray?: string;
  strokeDashoffset?: number;
} {
  if (draw >= 1) return {};
  return {
    className: "wb-draw",
    pathLength: 1,
    strokeDasharray: "1 1",
    strokeDashoffset: 1 - draw,
  };
}

/**
 * Opacity of part `i` of `n` (a matrix's cells, in reading order) while its object enters:
 * they fill in one after another behind the pen. 1 when not entering.
 */
export function staggerIn(enter: number, i: number, n: number): number {
  if (enter >= 1) return 1;
  const start = 0.2 + (n > 1 ? (0.45 * i) / (n - 1) : 0);
  return easeOutCubic(span(enter, start, 0.35));
}

export interface Look {
  /** The opacity to draw it with. */
  opacity: number;
  /** While it is being set: its opacity with reduced motion. */
  quick?: number;
}

/** A highlight being set: an eased fade, and a once-only pulse (0 at the ends, 1 halfway). */
export function highlightLook(progress: number): Look & { pulse: number } {
  if (progress >= 1) return { opacity: 1, pulse: 0 };
  return {
    opacity: easeOutCubic(progress),
    pulse: Math.sin(Math.PI * Math.max(0, progress)),
    quick: quickFade(progress),
  };
}

/** A written value fading in (a cell or a text's new value). */
export function writeLook(progress: number): Look {
  if (progress >= 1) return { opacity: 1 };
  return { opacity: easeOutCubic(progress), quick: quickFade(progress) };
}

/**
 * The class and style that let reduced motion (./board.css) replace an element's motion:
 * `wb-quick` and `--wb-quick` while it fades in, `wb-rise` while it rises, plus `className`.
 */
export function motionProps(
  look: { quick?: number; rise?: number },
  className?: string,
  style?: Record<string, string>,
): { className?: string; style?: CSSProperties } {
  const classes = [
    className,
    look.quick !== undefined && "wb-quick",
    (look.rise ?? 0) > 0 && "wb-rise",
  ].filter(Boolean);
  const vars = {
    ...style,
    ...(look.quick !== undefined ? { "--wb-quick": round(look.quick) } : {}),
  };
  return {
    ...(classes.length ? { className: classes.join(" ") } : {}),
    ...(Object.keys(vars).length ? { style: vars as CSSProperties } : {}),
  };
}

function round(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** Rounded for `data-draw`, so tests compare stable strings. */
export function drawAttr(draw: number): string {
  return String(Math.round(draw * 100) / 100);
}
