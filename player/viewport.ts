// The board's view (QA A4): the part of the 1600 x 900 canvas a step's drawing uses, so a
// small drawing fills the pane instead of sitting in the middle of empty board. Computed once
// per step from everything the step can show (hidden objects, where copies move to, arrow
// ends), so the view holds still while the step plays. 16:9 like the canvas, so the pane's
// layout doesn't change; zoomed at most MAX_ZOOM, so a lone formula isn't blown up.
import { type Box, objectBox } from "@/shared/boxes";
import {
  type Anchor,
  CANVAS,
  CELL,
  isPoint,
  type SceneObject,
} from "@/shared/scene";
import { VIZ_FONT } from "@/shared/viz";

/** The part of the canvas the board shows, in canvas units. */
export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_VIEW: ViewBox = { x: 0, y: 0, w: CANVAS.w, h: CANVAS.h };
/** Room (canvas px) kept around the drawing, for estimates that run short and highlight rings. */
export const VIEW_PAD = 56;
export const MAX_ZOOM = 2;

/** What a view is computed from: a step's (or a board's) objects and its move actions. */
interface Movement {
  do: string;
  target?: { id: string; row?: number; col?: number };
  to?: Anchor;
}

const union = (a: Box | undefined, b: Box): Box =>
  a
    ? {
        x0: Math.min(a.x0, b.x0),
        y0: Math.min(a.y0, b.y0),
        x1: Math.max(a.x1, b.x1),
        y1: Math.max(a.y1, b.y1),
      }
    : b;

function sceneBox(o: SceneObject): Box | undefined {
  switch (o.kind) {
    case "heatmap":
    case "plot":
      // A heatmap's title sits above its box; a plot's labels are inside it.
      return {
        x0: o.x,
        y0: o.y - (o.kind === "heatmap" && o.label ? VIZ_FONT.title + 24 : 0),
        x1: o.x + o.w,
        y1: o.y + o.h,
      };
    case "arrow": {
      // Its ends on objects are covered by those objects; its ends on points are its own.
      const ends = [o.from, o.to].filter(isPoint);
      return ends.reduce<Box | undefined>(
        (b, p) => union(b, { x0: p.x, y0: p.y, x1: p.x, y1: p.y }),
        undefined,
      );
    }
    default:
      return objectBox(o);
  }
}

/** Where everything the step can show lies, or undefined for an empty board. */
export function contentBox(
  objects: readonly SceneObject[],
  actions: readonly Movement[] = [],
): Box | undefined {
  let box: Box | undefined;
  for (const o of objects) {
    const b = sceneBox(o);
    if (b) box = union(box, b);
  }
  // A move to a point takes the object (or a copy of a matrix part) there, centred on it.
  for (const a of actions) {
    if (a.do !== "move" || !a.to || !isPoint(a.to) || !a.target) continue;
    const obj = objects.find((o) => o.id === a.target!.id);
    const own = obj && sceneBox(obj);
    let half = { w: 0, h: 0 };
    if (obj?.kind === "matrix") {
      const rows = a.target.row !== undefined ? 1 : obj.rows.length;
      const cols = a.target.col !== undefined ? 1 : obj.rows[0].length;
      half = { w: (cols * CELL.w) / 2, h: (rows * CELL.h) / 2 };
    } else if (own)
      half = { w: (own.x1 - own.x0) / 2, h: (own.y1 - own.y0) / 2 };
    box = union(box, {
      x0: a.to.x - half.w,
      y0: a.to.y - half.h,
      x1: a.to.x + half.w,
      y1: a.to.y + half.h,
    });
  }
  return box;
}

/** The 16:9 view around `box` with VIEW_PAD to spare, inside the canvas, zoomed at most MAX_ZOOM. */
export function cropView(box: Box | undefined): ViewBox {
  if (!box) return FULL_VIEW;
  const aspect = CANVAS.w / CANVAS.h;
  let w = Math.max(box.x1 - box.x0 + 2 * VIEW_PAD, CANVAS.w / MAX_ZOOM);
  let h = Math.max(box.y1 - box.y0 + 2 * VIEW_PAD, CANVAS.h / MAX_ZOOM);
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  if (w >= CANVAS.w || h >= CANVAS.h) return FULL_VIEW;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    x: round(clamp((box.x0 + box.x1) / 2 - w / 2, CANVAS.w - w)),
    y: round(clamp((box.y0 + box.y1) / 2 - h / 2, CANVAS.h - h)),
    w: round(w),
    h: round(h),
  };
}

/** The view for a step: everything it can show, with its moves. */
export function stepView(step: {
  objects: readonly SceneObject[];
  actions: readonly Movement[];
}): ViewBox {
  return cropView(contentBox(step.objects, step.actions));
}
