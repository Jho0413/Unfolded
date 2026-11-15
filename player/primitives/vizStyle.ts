// The progress-driven effects of the heatmap and plot primitives (issue #103): a revealed
// cell fading in, a series drawing on along x. Pure functions of the BoardState, so a seek
// shows the exact state (ARCHITECTURE.md section 5.3).
import type { ActiveAction } from "@/shared/scene";
import { coversCell } from "@/player/sceneAt";

/** Heatmap colour stops (Viz.module.css), low to high. */
const HEAT_STOPS = 5;

/**
 * The colour of a heatmap level (0..1): between two of the theme's stops, mixed in oklab so
 * the steps look even.
 */
export function heatColor(level: number): string {
  const at = Math.min(1, Math.max(0, level)) * (HEAT_STOPS - 1);
  const i = Math.min(HEAT_STOPS - 2, Math.floor(at));
  const frac = Math.round((at - i) * 100);
  if (frac === 0) return `var(--wb-heat-${i})`;
  if (frac === 100) return `var(--wb-heat-${i + 1})`;
  return `color-mix(in oklab, var(--wb-heat-${i + 1}) ${frac}%, var(--wb-heat-${i}))`;
}

/** Value text that reads on a cell of this level. */
export function heatTextColor(level: number): string {
  return level > 0.55 ? "var(--wb-heat-text-hi)" : "var(--wb-heat-text-lo)";
}

/** A plot series' colour (Viz.module.css). */
export function seriesColor(s: number): string {
  return `var(--wb-series-${s % 4})`;
}

function changed(a: ActiveAction, r: number, c: number): boolean {
  return a.cells
    ? a.cells.some(([cr, cc]) => cr === r && cc === c)
    : coversCell(a.action.target, r, c);
}

/**
 * How far a revealed cell (or a plot point) is drawn: `draw` is the progress of a `show` that
 * revealed it and is still running (1 if none), and `fade` the opacity a running `hide` leaves
 * it (sceneAt keeps it revealed until the hide ends). Parts only: a whole-object show or hide
 * fades the object (style.ts fadeOpacity).
 */
export function revealOf(
  active: readonly ActiveAction[],
  id: string,
  r: number,
  c: number,
): { draw: number; fade: number } {
  let draw = 1;
  let fade = 1;
  for (const a of active) {
    const { action } = a;
    if (action.target.id !== id) continue;
    if (action.target.row === undefined && action.target.col === undefined)
      continue;
    if (!changed(a, r, c)) continue;
    if (action.do === "show") {
      draw = a.progress;
      fade = 1;
    }
    if (action.do === "hide") fade = Math.min(fade, 1 - a.progress);
  }
  return { draw, fade };
}

/**
 * The part of a polyline drawn by `progress` (0..1) along x: the points up to the cut, plus
 * the point where the cut crosses the next segment. Points style (`joined` false) keeps only
 * whole points. A series with no x extent draws by point count instead.
 */
export function drawnPoints(
  points: readonly (readonly number[])[],
  progress: number,
  joined: boolean,
): [number, number][] {
  const p = Math.min(1, Math.max(0, progress));
  const pts = points.map(([x, y]) => [x, y] as [number, number]);
  if (p >= 1) return pts;
  const xs = pts.map(([x]) => x);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  if (hi === lo) return pts.slice(0, Math.floor(p * pts.length));
  const cut = lo + p * (hi - lo);
  if (!joined) return pts.filter(([x]) => x <= cut);
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    if (x <= cut) {
      out.push([x, y]);
      continue;
    }
    const prev = pts[i - 1];
    if (prev && prev[0] < cut) {
      const f = (cut - prev[0]) / (x - prev[0]);
      out.push([cut, prev[1] + f * (y - prev[1])]);
    }
    break;
  }
  return out;
}
