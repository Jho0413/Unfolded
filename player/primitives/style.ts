// Shared look and the progress-driven effects of the whiteboard primitives.
// Everything here is a pure function of the BoardState, so the board always
// matches the clock (ARCHITECTURE.md section 5.3): no animation state.
import type {
  Action,
  ActiveAction,
  HighlightColor,
  Target,
} from "@/shared/scene";

/** Light theme (ARCHITECTURE.md section 1). */
export const INK = "#1f2937";
export const MUTED = "#64748b";
export const BOARD_BG = "#ffffff";
export const COPY_STROKE = "#cbd5e1";
export const FONT =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const HIGHLIGHT: Record<
  HighlightColor,
  { fill: string; stroke: string }
> = {
  accent: { fill: "#dbeafe", stroke: "#2563eb" },
  warn: { fill: "#fef3c7", stroke: "#d97706" },
};

export const TEXT_SIZE = { s: 24, m: 32, l: 48 } as const;
export const CELL_FONT = 26;

/** The `data-highlight` value of a highlight. */
export function highlightAttr(color: HighlightColor | null | undefined) {
  return color ?? "none";
}

/** Whether an action target names exactly this part (or whole object). */
export function sameTarget(a: Target, b: Target): boolean {
  return a.id === b.id && a.row === b.row && a.col === b.col;
}

/** Whether a target covers cell (r, c) of matrix `id`. */
export function coversCell(t: Target, id: string, r: number, c: number) {
  return (
    t.id === id &&
    (t.row === undefined || t.row === r) &&
    (t.col === undefined || t.col === c)
  );
}

/**
 * Opacity of a whole object or a copy: a `show` in progress fades it in and a
 * `hide` in progress fades it out (sceneAt keeps it visible until the hide
 * ends). 1 when nothing is in progress.
 */
export function fadeOpacity(
  active: readonly ActiveAction[],
  target: Target,
): number {
  let opacity = 1;
  for (const { action, progress } of active) {
    if (!sameTarget(action.target, target)) continue;
    if (action.do === "show") opacity = Math.min(opacity, progress);
    if (action.do === "hide") opacity = Math.min(opacity, 1 - progress);
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
  if (action.do === "highlight") return (action.color ?? "accent") === current;
  if (action.do === "write") return action.value === current;
  return false;
}

/**
 * Progress (0..1) of the latest in-progress action of kind `kind` on matrix
 * cell (r, c) that set its `current` highlight or value, or 1 if none: a new
 * highlight or written value fades in. An unhighlight takes effect at once
 * (sceneAt clears the colour when it starts), so it doesn't fade out.
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
  for (const { action, progress } of active)
    if (
      action.do === kind &&
      coversCell(action.target, id, r, c) &&
      setsCurrent(action, current)
    )
      p = progress;
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
      action.target.row === undefined &&
      action.target.col === undefined &&
      setsCurrent(action, current)
    )
      p = progress;
  return p;
}

/** Rounded for `data-opacity`, so tests compare stable strings. */
export function opacityAttr(opacity: number): string {
  return String(Math.round(opacity * 100) / 100);
}
