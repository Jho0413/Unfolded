// "Try it yourself" widgets (issue #110): an optional, declarative widget a step ends with.
// The model fills in data; the browser computes. A plot widget's formula is parsed by
// ./expr.ts (whitelisted, never run as code), and a heatmap widget's scores go through a fixed
// transform. Pure, no node-only imports: the server validates and the browser renders.
import { z } from "zod";
import { compileExpr, RESERVED_NAMES } from "./expr";

export const WIDGET_LIMITS = {
  maxPromptChars: 160,
  maxParams: 4,
  maxExprChars: 200,
  /** An editable heatmap is 1..8 x 1..8 cells. */
  maxHeatmapDim: 8,
  maxLabelChars: 24,
  /** Points a plot widget samples its formula at, across `x`. */
  samples: 160,
  /** The largest score a learner can type into a heatmap cell. */
  maxScore: 1e6,
} as const;

/** A parameter name: like an object id, short, and not x, a constant or a function. */
export const PARAM_NAME_RE = /^[a-z][a-z0-9_]{0,15}$/;

const finite = z.number().finite();
const label = z.string().min(1).max(WIDGET_LIMITS.maxLabelChars);
const prompt = z.string().min(1).max(WIDGET_LIMITS.maxPromptChars);
/** `[min, max]` with min < max (an array: structured output rejects a zod tuple's schema). */
const range = z
  .array(finite)
  .length(2)
  .refine(([lo, hi]) => lo < hi, {
    message: "range must be [min, max] with min < max",
  });

/** A slider: `value` starts between `min` and `max`, moving in steps of `step`. */
const slider = {
  min: finite,
  max: finite,
  step: finite.positive(),
  value: finite,
};
function sliderOk(s: { min: number; max: number; value: number }) {
  return s.min < s.max && s.value >= s.min && s.value <= s.max;
}
const SLIDER_MESSAGE = "a slider needs min < max and min <= value <= max";

export const WidgetParam = z
  .object({
    name: z.string().regex(PARAM_NAME_RE),
    label,
    ...slider,
  })
  .refine(sliderOk, { message: SLIDER_MESSAGE });
export type WidgetParam = z.infer<typeof WidgetParam>;

/** A function of x with sliders for its parameters; the curve redraws as they move. */
export const PlotWidget = z.object({
  kind: z.literal("plot"),
  /** The tutor card's line: "Try it yourself: ...". */
  prompt,
  /** e.g. "a * exp(-b * x^2)": x, the params, pi, e, + - * / ^ ( ), sin cos tan exp log sqrt abs tanh min max. */
  expr: z.string().min(1).max(WIDGET_LIMITS.maxExprChars),
  x: range,
  /** The y axis. Absent: fitted to the curve at the sliders' starting values, then fixed. */
  y: range.optional(),
  params: z.array(WidgetParam).max(WIDGET_LIMITS.maxParams).default([]),
  xLabel: label.optional(),
  yLabel: label.optional(),
});
export type PlotWidget = z.infer<typeof PlotWidget>;

/** Editable scores shown live as a heatmap, optionally through softmax per row. */
export const HeatmapWidget = z
  .object({
    kind: z.literal("heatmap"),
    prompt,
    values: z
      .array(z.array(finite).min(1).max(WIDGET_LIMITS.maxHeatmapDim))
      .min(1)
      .max(WIDGET_LIMITS.maxHeatmapDim),
    rowLabels: z.array(label).optional(),
    colLabels: z.array(label).optional(),
    /** `softmax-rows`: each row becomes softmax(row / temperature), e.g. attention weights. */
    transform: z.literal("softmax-rows").optional(),
    /** A temperature slider (softmax-rows only), all above 0. */
    temperature: z
      .object(slider)
      .refine(sliderOk, { message: SLIDER_MESSAGE })
      .refine((t) => t.min > 0, { message: "temperature must be above 0" })
      .optional(),
  })
  .superRefine((w, ctx) => {
    const cols = w.values[0].length;
    if (!w.values.every((r) => r.length === cols))
      ctx.addIssue({
        code: "custom",
        message: "widget rows must all have the same length",
        path: ["values"],
      });
    if (w.rowLabels && w.rowLabels.length !== w.values.length)
      ctx.addIssue({
        code: "custom",
        message: `rowLabels needs one label per row (${w.values.length})`,
        path: ["rowLabels"],
      });
    if (w.colLabels && w.colLabels.length !== cols)
      ctx.addIssue({
        code: "custom",
        message: `colLabels needs one label per column (${cols})`,
        path: ["colLabels"],
      });
    if (w.temperature && w.transform !== "softmax-rows")
      ctx.addIssue({
        code: "custom",
        message: 'a temperature needs transform "softmax-rows"',
        path: ["temperature"],
      });
  });
export type HeatmapWidget = z.infer<typeof HeatmapWidget>;

export const Widget = z.union([PlotWidget, HeatmapWidget]);
export type Widget = z.infer<typeof Widget>;

export const widgetErrors = {
  expr: (why: string) => `widget expr: ${why}`,
  reservedParam: (name: string) => `widget param: reserved name "${name}"`,
  duplicateParam: (name: string) => `widget param: duplicate name "${name}"`,
  noFiniteValues: () =>
    "widget expr: no finite value anywhere on x at the starting values",
} as const;

/** The x values a plot widget is sampled at: `samples` evenly over its range, ends included. */
export function sampleXs(w: PlotWidget): number[] {
  const [lo, hi] = w.x;
  const n = WIDGET_LIMITS.samples;
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}

/** The sliders' starting values, by parameter name. */
export function startValues(w: PlotWidget): Record<string, number> {
  return Object.fromEntries(w.params.map((p) => [p.name, snapToStep(p)]));
}

/** A value on its slider's step grid, as the range input shows it (min 0.5, step 0.3: 1 is 1.1). */
export function snapToStep(p: {
  min: number;
  max: number;
  step: number;
  value: number;
}): number {
  let k = Math.round((p.value - p.min) / p.step);
  if (p.min + k * p.step > p.max + 1e-9 * p.step) k--;
  const v = p.min + k * p.step;
  return Number(v.toPrecision(12));
}

/**
 * The curve at these parameter values: `[x, y]` at every sample, y NaN where the formula
 * isn't finite (the renderer breaks the curve there). Undefined if the formula doesn't parse.
 */
export function sampleCurve(
  w: PlotWidget,
  values: Readonly<Record<string, number>>,
): [number, number][] | undefined {
  const compiled = compileExpr(w.expr, ["x", ...w.params.map((p) => p.name)]);
  if (!compiled.ok) return undefined;
  return sampleXs(w).map((x) => {
    const y = compiled.evaluate({ ...values, x });
    return [x, Number.isFinite(y) ? y : NaN];
  });
}

/** The y axis: the widget's own, or the finite samples' extent at the start, padded 10%. */
export function plotYRange(w: PlotWidget): [number, number] {
  if (w.y) return [w.y[0], w.y[1]];
  const ys = (sampleCurve(w, startValues(w)) ?? [])
    .map(([, y]) => y)
    .filter(Number.isFinite);
  if (ys.length === 0) return [-1, 1];
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const pad = hi > lo ? (hi - lo) * 0.1 : Math.max(1, Math.abs(lo) * 0.1);
  return [lo - pad, hi + pad];
}

/** softmax(row / temperature) per row; a row of equal scores is uniform. */
export function softmaxRows(
  values: readonly (readonly number[])[],
  temperature = 1,
): number[][] {
  return values.map((row) => {
    // Held finite, so a huge score or a tiny temperature can't make Infinity - Infinity.
    const scaled = row.map((v) =>
      Math.min(1e300, Math.max(-1e300, v / temperature)),
    );
    const top = Math.max(...scaled);
    const exps = scaled.map((v) => Math.exp(v - top));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((e) => e / sum);
  });
}

/** What a heatmap widget shows for these scores and temperature. */
export function heatmapView(
  w: HeatmapWidget,
  scores: readonly (readonly number[])[],
  temperature: number | undefined,
): number[][] {
  if (w.transform === "softmax-rows")
    return softmaxRows(scores, temperature ?? w.temperature?.value ?? 1);
  return scores.map((r) => [...r]);
}

/**
 * The rules zod can't express: the formula parses over x and the params, param names are
 * free and distinct, and the curve has a finite value somewhere at the starting values.
 */
export function checkWidget(w: Widget): string[] {
  if (w.kind !== "plot") return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of w.params) {
    if (RESERVED_NAMES.includes(p.name))
      out.push(widgetErrors.reservedParam(p.name));
    if (seen.has(p.name)) out.push(widgetErrors.duplicateParam(p.name));
    seen.add(p.name);
  }
  const compiled = compileExpr(w.expr, ["x", ...w.params.map((p) => p.name)]);
  if (!compiled.ok) out.push(widgetErrors.expr(compiled.error));
  else if (
    out.length === 0 &&
    !(sampleCurve(w, startValues(w)) ?? []).some(([, y]) => Number.isFinite(y))
  )
    out.push(widgetErrors.noFiniteValues());
  return out;
}
