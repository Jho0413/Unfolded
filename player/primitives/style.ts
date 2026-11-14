// Shared look and the progress-driven effects of the whiteboard primitives.
// Everything here is a pure function of the BoardState, so the board always
// matches the clock (ARCHITECTURE.md section 5.3): no animation state.
import type { ActiveAction, HighlightColor, Target } from "@/shared/scene";

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
 * Progress (0..1) of the latest in-progress action of kind `kind` on a
 * matrix cell, or 1 if none: a new highlight or written value fades in.
 */
export function cellProgress(
  active: readonly ActiveAction[],
  kind: "highlight" | "write",
  id: string,
  r: number,
  c: number,
): number {
  let p = 1;
  for (const { action, progress } of active)
    if (action.do === kind && coversCell(action.target, id, r, c)) p = progress;
  return p;
}

/** As `cellProgress`, for a whole non-matrix object. */
export function objectProgress(
  active: readonly ActiveAction[],
  kind: "highlight" | "write",
  id: string,
): number {
  let p = 1;
  for (const { action, progress } of active)
    if (
      action.do === kind &&
      action.target.id === id &&
      action.target.row === undefined &&
      action.target.col === undefined
    )
      p = progress;
  return p;
}

/** Rounded for `data-opacity`, so tests compare stable strings. */
export function opacityAttr(opacity: number): string {
  return String(Math.round(opacity * 100) / 100);
}
