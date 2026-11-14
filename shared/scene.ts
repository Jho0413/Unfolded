// The scene contract (ARCHITECTURE.md section 4). Imported by the server and
// the browser, so this file must stay free of node-only imports.
import { z } from "zod";

/** Virtual canvas: every coordinate is in this viewBox, origin top-left. */
export const CANVAS = { w: 1600, h: 900 } as const;

/** Fixed matrix cell size, so a board can be laid out without overlaps. */
export const CELL = { w: 64, h: 48 } as const;

/** Default duration of an action, in ms. */
export const DEFAULT_DURATION_MS = 400;
export const MAX_DURATION_MS = 3000;

/** Matrices are 1..8 x 1..8 cells. */
export const MAX_MATRIX_DIM = 8;

export const OBJECT_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * A well-formed cue marker in narration (ARCHITECTURE.md section 5.2).
 * Global: use with `matchAll` / `replace`, never with `test`.
 */
export const CUE_MARKER_RE = /\[\[([a-z][a-z0-9_]{0,31})\]\]/g;

export const ObjectId = z.string().regex(OBJECT_ID_RE);
export type ObjectId = z.infer<typeof ObjectId>;

const coord = z.number();
const index = z.number().int().min(0);

/** An object, or a row, column or cell of a matrix (0-based). */
export const Target = z.object({
  id: ObjectId,
  row: index.optional(),
  col: index.optional(),
});
export type Target = z.infer<typeof Target>;

export const Point = z.object({ x: coord, y: coord });
export type Point = z.infer<typeof Point>;

/** The centre of a target, or a point. */
export const Anchor = z.union([Target, Point]);
export type Anchor = z.infer<typeof Anchor>;

export function isPoint(anchor: Anchor): anchor is Point {
  return !("id" in anchor);
}

const hidden = z.boolean().optional();

export const MatrixObject = z
  .object({
    kind: z.literal("matrix"),
    id: ObjectId,
    x: coord,
    y: coord,
    rows: z
      .array(z.array(z.string()).min(1).max(MAX_MATRIX_DIM))
      .min(1)
      .max(MAX_MATRIX_DIM),
    label: z.string().optional(),
    hidden,
  })
  .refine((m) => m.rows.every((r) => r.length === m.rows[0].length), {
    message: "matrix rows must all have the same length",
    path: ["rows"],
  });

export const TextObject = z.object({
  kind: z.literal("text"),
  id: ObjectId,
  x: coord,
  y: coord,
  text: z.string(),
  size: z.enum(["s", "m", "l"]).optional(),
  hidden,
});

export const LatexObject = z.object({
  kind: z.literal("latex"),
  id: ObjectId,
  x: coord,
  y: coord,
  tex: z.string(),
  hidden,
});

export const ArrowObject = z.object({
  kind: z.literal("arrow"),
  id: ObjectId,
  from: Anchor,
  to: Anchor,
  label: z.string().optional(),
  hidden,
});

/** A fal illustration. The server adds `mediaUrl` later (E1); a model never writes it. */
export const ImageObject = z.object({
  kind: z.literal("image"),
  id: ObjectId,
  x: coord,
  y: coord,
  w: z.number().positive(),
  h: z.number().positive(),
  prompt: z.string().min(1),
  hidden,
});

// Plain z.union, not discriminatedUnion: zod emits `anyOf` for it, which
// structured output supports (`oneOf` is not on its list).
export const BoardObject = z.union([
  MatrixObject,
  TextObject,
  LatexObject,
  ArrowObject,
  ImageObject,
]);
export type BoardObject = z.infer<typeof BoardObject>;
export type MatrixObject = z.infer<typeof MatrixObject>;
export type TextObject = z.infer<typeof TextObject>;
export type LatexObject = z.infer<typeof LatexObject>;
export type ArrowObject = z.infer<typeof ArrowObject>;
export type ImageObject = z.infer<typeof ImageObject>;
export type ObjectKind = BoardObject["kind"];

export const HighlightColor = z.enum(["accent", "warn"]);
export type HighlightColor = z.infer<typeof HighlightColor>;

const durationMs = z
  .number()
  .int()
  .min(0)
  .max(MAX_DURATION_MS)
  .default(DEFAULT_DURATION_MS);

const actionShapes = {
  show: { do: z.literal("show"), target: Target, durationMs },
  hide: { do: z.literal("hide"), target: Target, durationMs },
  highlight: {
    do: z.literal("highlight"),
    target: Target,
    color: HighlightColor.optional(),
    durationMs,
  },
  unhighlight: {
    do: z.literal("unhighlight"),
    target: Target,
    color: HighlightColor.optional(),
    durationMs,
  },
  move: { do: z.literal("move"), target: Target, to: Anchor, durationMs },
  write: {
    do: z.literal("write"),
    target: Target,
    value: z.string(),
    durationMs,
  },
} as const;

/** Builds the action union with extra fields on every member (cue, atMs). */
function actionUnion<E extends z.ZodRawShape>(extra: E) {
  return z.union([
    z.object({ ...actionShapes.show, ...extra }),
    z.object({ ...actionShapes.hide, ...extra }),
    z.object({ ...actionShapes.highlight, ...extra }),
    z.object({ ...actionShapes.unhighlight, ...extra }),
    z.object({ ...actionShapes.move, ...extra }),
    z.object({ ...actionShapes.write, ...extra }),
  ]);
}

export const Action = actionUnion({});
export type Action = z.infer<typeof Action>;
export type ActionKind = Action["do"];

/** An action fired when its cue's word is spoken. */
export const CuedAction = actionUnion({
  cue: z.string().regex(OBJECT_ID_RE),
});
export type CuedAction = z.infer<typeof CuedAction>;

/** An action fired at a time offset, with no narration (Q&A sketches). */
export const TimedSketchAction = actionUnion({ atMs: z.number().int().min(0) });
export type TimedSketchAction = z.infer<typeof TimedSketchAction>;

/** What Claude writes for one lesson step. */
export const Step = z.object({
  title: z.string().min(1),
  /** With cue markers: "Take the first [[row1]]row..." */
  narration: z.string().min(1),
  /** The board when the step starts. */
  objects: z.array(BoardObject),
  actions: z.array(CuedAction),
});
export type Step = z.infer<typeof Step>;

/** What /api/sketch returns for a Q&A drawing. */
export const Sketch = z.object({
  /** Added to the current board, or to an empty one with `fresh`. */
  objects: z.array(BoardObject),
  actions: z.array(TimedSketchAction),
});
export type Sketch = z.infer<typeof Sketch>;

/**
 * The board at one moment (ARCHITECTURE.md section 5.3), produced by
 * `sceneAt` and sent to /api/sketch. First version: P2 may refine it (post on
 * the board when it changes).
 */
export const ObjectState = z.object({
  /** The object as it is now: positions moved, values written. */
  object: BoardObject,
  visible: z.boolean(),
  /** Whole-object highlight (non-matrix objects). */
  highlight: HighlightColor.nullable(),
  /** Per-cell highlight, same shape as `rows` (matrix objects only). */
  cellHighlight: z.array(z.array(HighlightColor.nullable())).optional(),
});
export type ObjectState = z.infer<typeof ObjectState>;

/** A moved copy of a matrix row, column or cell. Values and highlight come from the source cells. */
export const PartCopy = z.object({
  source: Target,
  /** Centre of the copy now. */
  x: coord,
  y: coord,
  visible: z.boolean(),
});
export type PartCopy = z.infer<typeof PartCopy>;

export const ActiveAction = z.object({
  action: Action,
  /** How far along the action is, 0..1. */
  progress: z.number().min(0).max(1),
  /**
   * For a highlight, unhighlight or write on a matrix: the cells [row, col]
   * it changed that no later action has changed since. The renderer fades in
   * only these. Absent for every other action.
   */
  cells: z
    .array(z.tuple([z.number().int().min(0), z.number().int().min(0)]))
    .optional(),
});
export type ActiveAction = z.infer<typeof ActiveAction>;

export const BoardState = z.object({
  objects: z.array(ObjectState),
  copies: z.array(PartCopy),
  active: z.array(ActiveAction),
});
export type BoardState = z.infer<typeof BoardState>;

/** Centre of cell (r, c) of a matrix whose top-left corner is (x, y). */
export function cellCentre(x: number, y: number, r: number, c: number): Point {
  return { x: x + CELL.w * c + CELL.w / 2, y: y + CELL.h * r + CELL.h / 2 };
}
