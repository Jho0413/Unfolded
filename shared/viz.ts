// Where a heatmap's cells and a plot's points are drawn (issue #103). One source for sceneAt
// (anchors: an arrow to a cell or a point) and the renderer (player/primitives), so both
// agree. Pure, no node-only imports: the server and the browser use it.
import type { HeatmapObject, PlotObject, Point } from "./scene";

/** Font sizes (px) of heatmap and plot labels. */
export const VIZ_FONT = { label: 20, tick: 18, axis: 22, title: 28 } as const;
/** A label's average character width, in ems: errs wide for the board's serif. */
const CHAR_EM = 0.6;
const GAP = 10;

/** A box on the canvas. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function labelWidth(labels: readonly string[], font: number): number {
  return Math.max(0, ...labels.map((l) => [...l].length)) * font * CHAR_EM;
}

export interface HeatmapLayout {
  /** The cells' area: the box less the label gutters. */
  grid: Rect;
  cellW: number;
  cellH: number;
}

/** The heatmap's grid inside its box: row labels take a gutter on the left, column labels on top. */
export function heatmapLayout(m: HeatmapObject): HeatmapLayout {
  const left = m.rowLabels ? labelWidth(m.rowLabels, VIZ_FONT.label) + GAP : 0;
  const top = m.colLabels ? VIZ_FONT.label * 1.4 + GAP : 0;
  const grid = { x: m.x + left, y: m.y + top, w: m.w - left, h: m.h - top };
  return {
    grid,
    cellW: grid.w / m.values[0].length,
    cellH: grid.h / m.values.length,
  };
}

/** Centre of heatmap cell (r, c). */
export function heatmapCellCentre(
  m: HeatmapObject,
  r: number,
  c: number,
): Point {
  const { grid, cellW, cellH } = heatmapLayout(m);
  return { x: grid.x + cellW * (c + 0.5), y: grid.y + cellH * (r + 0.5) };
}

/**
 * The scale a heatmap's colours run between: its `scale`, or its values' min and max (a
 * constant grid gets a range of 1 so it still has a colour).
 */
export function heatmapScale(m: HeatmapObject): { min: number; max: number } {
  if (m.scale) return m.scale;
  const flat = m.values.flat();
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  return max > min ? { min, max } : { min, max: min + 1 };
}

/** Where `v` sits on the heatmap's scale, clamped to 0..1. */
export function heatmapLevel(m: HeatmapObject, v: number): number {
  const { min, max } = heatmapScale(m);
  return Math.min(1, Math.max(0, (v - min) / (max - min)));
}

export interface PlotLayout {
  /** The plotting area, inside the axes. */
  area: Rect;
  /** Data units to canvas. */
  toCanvas: (x: number, y: number) => Point;
}

/** The plot's axes inside its box: tick labels and axis labels take gutters left and below. */
export function plotLayout(p: PlotObject): PlotLayout {
  const yTicks = niceTicks(p.yRange[0], p.yRange[1]);
  const left =
    labelWidth(yTicks.map(formatTick), VIZ_FONT.tick) +
    GAP +
    (p.yLabel ? VIZ_FONT.axis * 1.4 : 0);
  const bottom =
    VIZ_FONT.tick * 1.4 + GAP + (p.xLabel ? VIZ_FONT.axis * 1.4 : 0);
  // Room above and right for the last tick label, half of which overhangs the axis.
  const top = VIZ_FONT.tick;
  const right = VIZ_FONT.tick * 1.5;
  const area = {
    x: p.x + left,
    y: p.y + top,
    w: p.w - left - right,
    h: p.h - top - bottom,
  };
  const [x0, x1] = p.xRange;
  const [y0, y1] = p.yRange;
  return {
    area,
    toCanvas: (x, y) => ({
      x: area.x + ((x - x0) / (x1 - x0)) * area.w,
      y: area.y + area.h - ((y - y0) / (y1 - y0)) * area.h,
    }),
  };
}

/** Where point `i` of series `s` is drawn. */
export function plotPoint(p: PlotObject, s: number, i: number): Point {
  const [x, y] = p.series[s].points[i];
  return plotLayout(p).toCanvas(x, y);
}

/**
 * About `target` round tick values covering [lo, hi]: steps of 1, 2 or 5 times a power of
 * ten, whichever gives the count nearest `target`.
 */
export function niceTicks(lo: number, hi: number, target = 5): number[] {
  const mag = 10 ** Math.floor(Math.log10((hi - lo) / target));
  const ticks = (step: number) => {
    const out: number[] = [];
    for (
      let v = Math.ceil(lo / step - 1e-9) * step;
      v <= hi + step * 1e-9;
      v += step
    )
      out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
    return out;
  };
  const options = [1, 2, 5, 10].map((m) => ticks(m * mag));
  return options.reduce((best, t) =>
    Math.abs(t.length - target) < Math.abs(best.length - target) ? t : best,
  );
}

/** A tick or cell value, short: integers as is, others to at most 2 decimals. */
export function formatTick(v: number): string {
  if (Number.isInteger(v)) return String(v);
  if (Math.abs(v) >= 0.01) return String(Number(v.toFixed(2)));
  return String(Number(v.toPrecision(2)));
}
