// Shared look and the progress-driven effects of the whiteboard primitives.
// Everything here is a pure function of the BoardState, so the board always
// matches the clock (ARCHITECTURE.md section 5.3): no animation state.
import type {
  Action,
  ActiveAction,
  HighlightColor,
  Target,
} from "@/shared/scene";
import { coversCell, highlightColor, isPart, partKey } from "@/player/sceneAt";

/**
 * The board's colours and font, as CSS custom properties: both themes' values are in
 * player/theme.css (ARCHITECTURE.md section 1), so the board, and a drawn answer, follow the
 * theme.
 */
export const INK = "var(--wb-ink)";
export const MUTED = "var(--wb-muted)";
export const BOARD_BG = "var(--wb-board)";
export const COPY_STROKE = "var(--wb-copy-stroke)";
/** The page behind the board, and the board's frame. */
export const PAGE_BG = "var(--wb-page)";
export const FRAME_BORDER = "var(--wb-frame)";
/** STIX Two Text (next/font, app/layout.tsx): the board's numerals and maths. */
export const FONT = "var(--wb-font)";

/** `accent` is the lesson's yellow, in a drawn answer too. */
export const HIGHLIGHT: Record<
  HighlightColor,
  { fill: string; stroke: string }
> = {
  accent: { fill: "var(--wb-accent-fill)", stroke: "var(--wb-accent)" },
  warn: { fill: "var(--wb-warn-fill)", stroke: "var(--wb-warn)" },
};

export const CELL_FONT = 26;

/**
 * The box a latex object is laid out in, centred on its x,y. KaTeX's size is
 * only known after layout, so the formula is centred in a box big enough for
 * any lesson formula; what overflows it is still drawn.
 */
export const LATEX_BOX = { w: 1200, h: 400 } as const;

/** Colour of tex KaTeX can't render (KaTeX's own default). */
export const LATEX_ERROR = "#cc0000";

/**
 * Arrow look. An end that names a target stops `margin` outside the target's
 * box, so the head points at the object instead of covering it; a point end
 * is exact.
 */
export const ARROW = {
  stroke: 3,
  head: { len: 18, w: 14 },
  margin: 10,
  labelFont: 22,
  /**
   * Clear space between the line and the nearest edge of its label's box: wide enough that
   * the label never reads as struck through (#90).
   */
  labelGap: 14,
  /** The board-coloured outline behind a label, so it reads over the line. */
  labelHalo: 6,
} as const;

/** The `data-highlight` value of a highlight. */
export function highlightAttr(color: HighlightColor | null | undefined) {
  return color ?? "none";
}

/**
 * Opacity of a whole object or a copy: a `show` in progress fades it in and a
 * `hide` in progress fades it out (sceneAt keeps it visible until the hide
 * ends). 1 when nothing is in progress. A show of an object already visible
 * never fades from 0: sceneAt leaves actions that change nothing out of
 * `active`.
 *
 * `active` is in start order, so the later of a show and a hide takes over
 * with no jump: a show during a hide takes the larger opacity (the object
 * keeps fading out until the show overtakes), and a hide during a show the
 * smaller (it keeps fading in until the hide overtakes).
 */
export function fadeOpacity(
  active: readonly ActiveAction[],
  target: Target,
): number {
  let opacity = 1;
  let hiding = false;
  for (const { action, progress } of active) {
    if (partKey(action.target) !== partKey(target)) continue;
    if (action.do === "hide") {
      opacity = Math.min(opacity, 1 - progress);
      hiding = true;
    }
    if (action.do === "show")
      opacity = hiding
        ? Math.max(opacity, progress)
        : Math.min(opacity, progress);
  }
  return opacity;
}

/**
 * Whether an in-progress action set what a cell or object shows now: a
 * highlight in the colour it has, or a write of the value it has. Then it
 * fades in with that action's progress, and never borrows the progress of an
 * action whose result was since overwritten.
 */
function setsCurrent(action: Action, current: string | null): boolean {
  if (action.do === "highlight") return highlightColor(action) === current;
  if (action.do === "write") return action.value === current;
  return false;
}

/**
 * Whether an in-progress action changed matrix cell (r, c): one of its
 * `cells` (set by sceneAt), or any cell its target covers if `cells` is absent.
 */
function changedCell(a: ActiveAction, r: number, c: number): boolean {
  return a.cells
    ? a.cells.some(([cr, cc]) => cr === r && cc === c)
    : coversCell(a.action.target, r, c);
}

/**
 * Progress (0..1) of the latest in-progress action of kind `kind` that
 * changed matrix cell (r, c) and set its `current` highlight or value, or 1
 * if none: a new highlight or written value fades in, and a cell that already
 * had it doesn't blink. An unhighlight takes effect at once (sceneAt clears
 * the colour when it starts), so it doesn't fade out.
 */
export function cellProgress(
  active: readonly ActiveAction[],
  kind: "highlight" | "write",
  id: string,
  r: number,
  c: number,
  current: string | null,
): number {
  let p = 1;
  for (const a of active)
    if (
      a.action.do === kind &&
      a.action.target.id === id &&
      changedCell(a, r, c) &&
      setsCurrent(a.action, current)
    )
      p = a.progress;
  return p;
}

/** As `cellProgress`, for a whole non-matrix object. */
export function objectProgress(
  active: readonly ActiveAction[],
  kind: "highlight" | "write",
  id: string,
  current: string | null,
): number {
  let p = 1;
  for (const { action, progress } of active)
    if (
      action.do === kind &&
      action.target.id === id &&
      !isPart(action.target) &&
      setsCurrent(action, current)
    )
      p = progress;
  return p;
}

/** Rounded for `data-opacity`, so tests compare stable strings. */
export function opacityAttr(opacity: number): string {
  return String(Math.round(opacity * 100) / 100);
}
