// Where an arrow's line, head and label go, from its two resolved ends and
// the boxes of the targets they name. Pure, so it is unit-tested without a
// browser.
import {
  type Anchor,
  type BoardState,
  CELL,
  isPoint,
  type Point,
} from "@/shared/scene";
import { objectBox, type Size, TEXT_SIZE, textBox } from "@/shared/boxes";
import { heatmapLayout } from "@/shared/viz";
import { renderLatex } from "./katex";
import { ARROW } from "./style";

/**
 * What an arrow end stops at: a box centred on where the end resolves, and
 * `above`, how much further it reaches up (a whole matrix's label), so an
 * arrow coming from above stops over the label instead of crossing it.
 */
export type TargetBox = Size & { above?: number };

/**
 * The box of what an arrow end names, centred on where it resolves: a matrix's
 * cells (and its label above them), the cells of a row, column or cell (or its
 * moved copy, the same size), a text's box, an image, or a formula's estimated
 * box. Undefined for a point (the arrow ends exactly on it) or an unknown
 * target.
 */
export function targetBox(
  board: BoardState,
  anchor: Anchor,
): TargetBox | undefined {
  if (isPoint(anchor)) return undefined;
  const object = board.objects.find((s) => s.object.id === anchor.id)?.object;
  switch (object?.kind) {
    case undefined:
    case "arrow": // validate.ts rejects arrows anchored to arrows
      return undefined;
    case "matrix": {
      const box = {
        w: (anchor.col === undefined ? object.rows[0].length : 1) * CELL.w,
        h: (anchor.row === undefined ? object.rows.length : 1) * CELL.h,
      };
      const whole = anchor.row === undefined && anchor.col === undefined;
      if (!whole || !object.label) return box;
      // The label's top (shared/boxes.ts, as the validator spaces it) above the cells' top.
      return { ...box, above: object.y - (objectBox(object)?.y0 ?? object.y) };
    }
    case "text":
      return textBox(object.text, TEXT_SIZE[object.size ?? "m"]);
    case "latex":
      return renderLatex(object.tex).size;
    case "image":
      return { w: object.w, h: object.h };
    case "heatmap": {
      // #103: the whole box, or the cells of a row, column or cell.
      if (anchor.row === undefined && anchor.col === undefined)
        return { w: object.w, h: object.h };
      const { cellW, cellH } = heatmapLayout(object);
      return {
        w: (anchor.col === undefined ? object.values[0].length : 1) * cellW,
        h: (anchor.row === undefined ? object.values.length : 1) * cellH,
      };
    }
    case "plot":
      // #103: the whole box; a series or point is a point the arrow ends on.
      return anchor.row === undefined
        ? { w: object.w, h: object.h }
        : undefined;
  }
}

/**
 * How far from a box's centre, along unit direction (ux, uy), its edge is.
 * The top edge is `above` further out.
 */
function toEdge(box: TargetBox, ux: number, uy: number): number {
  const up = uy < 0 ? (box.above ?? 0) : 0;
  const x = ux === 0 ? Infinity : box.w / 2 / Math.abs(ux);
  const y = uy === 0 ? Infinity : (box.h / 2 + up) / Math.abs(uy);
  return Math.min(x, y);
}

export interface ArrowGeometry {
  /** The line, from the start to the base of the head. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The head, a triangle as SVG `points`, its tip on the drawn end. */
  head: string;
  /**
   * Where the label is centred: beside the middle of the line, on its upper
   * side, far enough out that its box clears the line by `ARROW.labelGap`.
   */
  label: Point;
}

/**
 * The arrow from `from` to `to`. An end with a box (see `targetBox`) stops
 * `ARROW.margin` outside it; an end without one is exact. `labelBox` is the
 * label's size, if there is one. Insets shrink when they would leave less than
 * `ARROW.minLength` of the arrow, never below half the length between the
 * ends, so a short arrow still shows. Undefined
 * when the ends coincide: there is no direction to draw.
 */
export function arrowGeometry(
  from: Point,
  to: Point,
  fromBox?: TargetBox,
  toBox?: TargetBox,
  labelBox?: Size,
): ArrowGeometry | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return undefined;
  const ux = dx / len;
  const uy = dy / len;
  // Each end's edge, looking out from its centre: along the arrow from the
  // start, back against it from the end.
  const inset = (box: TargetBox | undefined, sx: number, sy: number) =>
    box ? toEdge(box, sx, sy) + ARROW.margin : 0;
  const insetFrom = inset(fromBox, ux, uy);
  const insetTo = inset(toBox, -ux, -uy);

  const insets = insetFrom + insetTo;
  const room = Math.max(len / 2, len - ARROW.minLength);
  const scale = insets > room ? room / insets : 1;
  const start = {
    x: from.x + ux * insetFrom * scale,
    y: from.y + uy * insetFrom * scale,
  };
  const tip = {
    x: to.x - ux * insetTo * scale,
    y: to.y - uy * insetTo * scale,
  };
  const visible = Math.hypot(tip.x - start.x, tip.y - start.y);

  const headLen = Math.min(ARROW.head.len, visible);
  const base = { x: tip.x - ux * headLen, y: tip.y - uy * headLen };
  // Unit normal, turned to point up the screen (or left, for a vertical line).
  let nx = -uy;
  let ny = ux;
  if (ny > 0 || (ny === 0 && nx > 0)) {
    nx = -nx;
    ny = -ny;
  }
  const half = ARROW.head.w / 2;
  const fmt = (p: Point) => `${p.x},${p.y}`;
  const head = [
    tip,
    { x: base.x + nx * half, y: base.y + ny * half },
    { x: base.x - nx * half, y: base.y - ny * half },
  ]
    .map(fmt)
    .join(" ");

  // The label box's half extent across the line, so the box clears it.
  const across = labelBox
    ? (Math.abs(nx) * labelBox.w + Math.abs(ny) * labelBox.h) / 2
    : 0;
  const offset = ARROW.labelGap + across;
  return {
    x1: start.x,
    y1: start.y,
    x2: base.x,
    y2: base.y,
    head,
    label: {
      x: (start.x + tip.x) / 2 + nx * offset,
      y: (start.y + tip.y) / 2 + ny * offset,
    },
  };
}
