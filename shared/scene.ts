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

/** Heatmap and plot limits (issue #103): small enough for a generated scene to stay small. */
export const VIZ_LIMITS = {
  /** A heatmap is 1..12 x 1..12 cells. */
  maxHeatmapDim: 12,
  /** A plot has 1..4 series of 2..200 points. */
  maxSeries: 4,
  maxPoints: 200,
  /** Row, column, axis and series labels. */
  maxLabelChars: 24,
  /** The smallest heatmap or plot box, so its labels and ticks fit. */
  minSize: 120,
} as const;

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

const finite = z.number().finite();
const vizLabel = z.string().min(1).max(VIZ_LIMITS.maxLabelChars);
const vizSize = z.number().min(VIZ_LIMITS.minSize);
/**
 * Two numbers. An array, not a tuple: the structured-output schema transform rejects the
 * JSON schema of a zod tuple.
 */
const pair = z.array(finite).length(2);
/** `[min, max]` with min < max. */
const range = pair.refine(([lo, hi]) => lo < hi, {
  message: "range must be [min, max] with min < max",
});

/**
 * A grid of numbers drawn as coloured cells (issue #103), e.g. attention weights. Everything,
 * labels included, is drawn inside the box `x, y, w, h`. Targets name cells as a matrix's do:
 * `row`, `col`, or both. With `cellsHidden` the grid starts blank, and a `show` on a row,
 * column or cell reveals it.
 */
export const HeatmapObject = z
  .object({
    kind: z.literal("heatmap"),
    id: ObjectId,
    x: coord,
    y: coord,
    w: vizSize,
    h: vizSize,
    values: z
      .array(z.array(finite).min(1).max(VIZ_LIMITS.maxHeatmapDim))
      .min(1)
      .max(VIZ_LIMITS.maxHeatmapDim),
    rowLabels: z.array(vizLabel).optional(),
    colLabels: z.array(vizLabel).optional(),
    /** The values the colour scale runs between; the values' own min and max by default. */
    scale: z
      .object({ min: finite, max: finite })
      .refine((s) => s.min < s.max, {
        message: "scale.min must be less than scale.max",
      })
      .optional(),
    /** Write each value in its cell. */
    showValues: z.boolean().optional(),
    /** Cells start blank; `show` on a row, column or cell reveals them. */
    cellsHidden: z.boolean().optional(),
    label: z.string().optional(),
    hidden,
  })
  .superRefine((m, ctx) => {
    const cols = m.values[0].length;
    if (!m.values.every((r) => r.length === cols))
      ctx.addIssue({
        code: "custom",
        message: "heatmap rows must all have the same length",
        path: ["values"],
      });
    if (m.rowLabels && m.rowLabels.length !== m.values.length)
      ctx.addIssue({
        code: "custom",
        message: `rowLabels needs one label per row (${m.values.length})`,
        path: ["rowLabels"],
      });
    if (m.colLabels && m.colLabels.length !== cols)
      ctx.addIssue({
        code: "custom",
        message: `colLabels needs one label per column (${cols})`,
        path: ["colLabels"],
      });
  });

/** One curve or point set of a plot, as sampled points in data units. */
export const PlotSeries = z
  .object({
    points: z.array(pair).min(2).max(VIZ_LIMITS.maxPoints),
    label: vizLabel.optional(),
    /** `line` (default) joins the points in order; `points` draws a dot at each. */
    style: z.enum(["line", "points"]).optional(),
    /** Not drawn until a `show` on it (target `{ id, row: <series index> }`) draws it on. */
    hidden,
  })
  .refine(
    (s) =>
      s.style === "points" ||
      s.points.every((p, i) => i === 0 || p[0] >= s.points[i - 1][0]),
    {
      message:
        "a line series' x values must not decrease (it draws on along x)",
      path: ["points"],
    },
  );
export type PlotSeries = z.infer<typeof PlotSeries>;

/**
 * Axes with one or more sampled series (issue #103), e.g. a softmax curve. Everything, ticks
 * and axis labels included, is drawn inside the box `x, y, w, h`; points outside the ranges
 * are clipped. Targets: `{ id, row: s }` is series s, `{ id, row: s, col: p }` its point p.
 */
export const PlotObject = z.object({
  kind: z.literal("plot"),
  id: ObjectId,
  x: coord,
  y: coord,
  w: vizSize,
  h: vizSize,
  xRange: range,
  yRange: range,
  series: z.array(PlotSeries).min(1).max(VIZ_LIMITS.maxSeries),
  xLabel: vizLabel.optional(),
  yLabel: vizLabel.optional(),
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
export type HeatmapObject = z.infer<typeof HeatmapObject>;
export type PlotObject = z.infer<typeof PlotObject>;

/**
 * Every object a lesson step can draw: the board objects plus the data objects (issue #103).
 * `BoardObject` stays the objects the step and sketch generators write today: the wire format
 * (lib/pipeline/outputFormat.ts) embeds it, and the API has no headroom for more kinds (S3),
 * so heatmap and plot join the wire only after a real request with the bigger schema.
 */
export const SceneObject = z.union([
  MatrixObject,
  TextObject,
  LatexObject,
  ArrowObject,
  ImageObject,
  HeatmapObject,
  PlotObject,
]);
export type SceneObject = z.infer<typeof SceneObject>;
export type ObjectKind = SceneObject["kind"];
/** Objects whose parts are cells a target names by row and col. */
export type GridObject = MatrixObject | HeatmapObject | PlotObject;

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

/** The longest `PaperRef.quote`: a sentence or two, never a paragraph. */
export const MAX_PAPER_QUOTE_CHARS = 300;

/**
 * A passage of the uploaded paper (issue #98). `quote` is verbatim from page `page`: it is
 * found with shared/paperText.ts `findQuote`, which ignores case, whitespace, hyphens and
 * ligatures, so the server and the browser agree on what "verbatim" means.
 */
export const PaperRef = z.object({
  /** 1-based page of the PDF. */
  page: z.number().int().min(1),
  quote: z.string().min(1).max(MAX_PAPER_QUOTE_CHARS),
  /** What the passage is, e.g. "Eq. 1" or "Section 3.2". */
  label: z.string().min(1).optional(),
});
export type PaperRef = z.infer<typeof PaperRef>;

/**
 * A paper passage the step points at: highlighted from when its cue's word is spoken
 * (`cueTimes[cue]`), or from the step's start without a cue, until the next one starts.
 */
export const CuedPaperRef = PaperRef.extend({
  cue: z.string().regex(OBJECT_ID_RE).optional(),
});
export type CuedPaperRef = z.infer<typeof CuedPaperRef>;

/** What Claude writes for one lesson step. */
export const Step = z.object({
  title: z.string().min(1),
  /** With cue markers: "Take the first [[row1]]row..." */
  narration: z.string().min(1),
  /** The board when the step starts. */
  objects: z.array(SceneObject),
  actions: z.array(CuedAction),
  /** Passages of the paper, in narration order (issue #98). Absent in older runs. */
  paperRefs: z.array(CuedPaperRef).optional(),
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
  object: SceneObject,
  visible: z.boolean(),
  /** Whole-object highlight (non-grid objects). */
  highlight: HighlightColor.nullable(),
  /**
   * Per-cell highlight of a grid object, same shape as its cells (`gridShape`): a matrix's
   * `rows`, a heatmap's `values`, a plot's series points.
   */
  cellHighlight: z.array(z.array(HighlightColor.nullable())).optional(),
  /** Per-cell visibility, same shape (heatmap and plot only): revealed cells, drawn series. */
  cellVisible: z.array(z.array(z.boolean())).optional(),
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
   * For a highlight, unhighlight or write on a grid object (a matrix, heatmap
   * or plot), or a show or hide of a heatmap's cells or a plot's series: the
   * cells [row, col] it changed that no later action has changed since. The
   * renderer fades in (or draws on) only these. Absent for every other action.
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

/** A board with nothing on it (a step still loading, a drawn answer's starting board). */
export const EMPTY_BOARD: BoardState = { objects: [], copies: [], active: [] };

/** Centre of cell (r, c) of a matrix whose top-left corner is (x, y). */
export function cellCentre(x: number, y: number, r: number, c: number): Point {
  return { x: x + CELL.w * c + CELL.w / 2, y: y + CELL.h * r + CELL.h / 2 };
}

/** A grid object's cells: one entry per row (a plot's series) giving its length. */
export function gridShape(obj: GridObject): number[] {
  switch (obj.kind) {
    case "matrix":
      return obj.rows.map((r) => r.length);
    case "heatmap":
      return obj.values.map((r) => r.length);
    case "plot":
      return obj.series.map((s) => s.points.length);
  }
}

export function isGrid(obj: SceneObject): obj is GridObject {
  return obj.kind === "matrix" || obj.kind === "heatmap" || obj.kind === "plot";
}
