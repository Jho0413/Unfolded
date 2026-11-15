// "Try it yourself" widgets (issue #110, shared/widget.ts): the validation row of #110's
// behaviour table (named errors, so the generator retries), and the pure maths the panel
// draws from (sampling, NaN gaps, the y axis, softmax per row).
import { describe, expect, it } from "vitest";
import { FAKE_WIDGETS } from "@/app/dev/player/fakeWidgets";
import demoM1 from "@/lib/fakes/fixtures/demo-m1.step.json";
import { Step } from "@/shared/scene";
import { validateStep } from "@/shared/validate";
import {
  heatmapView,
  plotYRange,
  sampleCurve,
  snapToStep,
  softmaxRows,
  startValues,
  WIDGET_LIMITS,
  widgetErrors,
} from "@/shared/widget";

const limits = { maxNarrationChars: 2000 };
const m1Step = Step.parse(demoM1);
const plot = (over: Record<string, unknown> = {}) => ({
  kind: "plot",
  prompt: "Try it yourself.",
  expr: "a * x",
  x: [-1, 1],
  params: [{ name: "a", label: "slope", min: -2, max: 2, step: 0.5, value: 1 }],
  ...over,
});
const heat = (over: Record<string, unknown> = {}) => ({
  kind: "heatmap",
  prompt: "Try it yourself.",
  values: [
    [1, 2],
    [3, 4],
  ],
  ...over,
});
const errorsOf = (widget: unknown) => {
  const r = validateStep({ ...m1Step, widget } as Step, limits);
  return r.ok ? [] : r.errors;
};

describe("validation: invalid expr / unknown param / out-of-range values are rejected with a named error", () => {
  it("valid: both fixtures, a plot with no params, and a heatmap without a transform", () => {
    expect(errorsOf(FAKE_WIDGETS.plot)).toEqual([]);
    expect(errorsOf(FAKE_WIDGETS.heatmap)).toEqual([]);
    expect(errorsOf(plot({ expr: "sin(x)", params: [] }))).toEqual([]);
    expect(errorsOf(heat())).toEqual([]);
  });

  it("an unknown name in the expr", () => {
    expect(errorsOf(plot({ expr: "a * y" }))).toEqual([
      widgetErrors.expr('unknown name "y"'),
    ]);
  });

  it("an expr that doesn't parse", () => {
    expect(errorsOf(plot({ expr: "a * (x" }))).toEqual([
      'widget expr: expected ")", found the end',
    ]);
    expect(errorsOf(plot({ expr: "eval(x)" }))).toEqual([
      'widget expr: unknown name "eval"',
    ]);
  });

  it("a param named like x, a constant or a function, or twice", () => {
    const p = (name: string) => ({
      name,
      label: name,
      min: 0,
      max: 1,
      step: 0.1,
      value: 0.5,
    });
    expect(errorsOf(plot({ params: [p("x")] }))).toContain(
      widgetErrors.reservedParam("x"),
    );
    expect(errorsOf(plot({ params: [p("sin")] }))).toContain(
      widgetErrors.reservedParam("sin"),
    );
    expect(errorsOf(plot({ expr: "a", params: [p("a"), p("a")] }))).toEqual([
      widgetErrors.duplicateParam("a"),
    ]);
  });

  it("an expr with no finite value anywhere at the starting values", () => {
    expect(errorsOf(plot({ expr: "log(-1 - x^2)", params: [] }))).toEqual([
      widgetErrors.noFiniteValues(),
    ]);
  });

  it("a slider value outside min..max, or min >= max, or step <= 0", () => {
    const param = (over: object) => [
      { name: "a", label: "a", min: 0, max: 1, step: 0.1, value: 0.5, ...over },
    ];
    for (const over of [{ value: 2 }, { min: 1, max: 0 }])
      expect(errorsOf(plot({ params: param(over) }))).toContain(
        "widget.params.0: a slider needs min < max and min <= value <= max",
      );
    expect(errorsOf(plot({ params: param({ step: 0 }) })).length).toBe(1);
  });

  it(`more than ${WIDGET_LIMITS.maxParams} params, or an x range with min >= max`, () => {
    const p = (name: string) => ({
      name,
      label: name,
      min: 0,
      max: 1,
      step: 0.1,
      value: 0,
    });
    expect(
      errorsOf(plot({ params: ["a", "b", "c", "d", "f"].map(p) })).length,
    ).toBe(1);
    expect(errorsOf(plot({ x: [1, 1] }))).toContain(
      "widget.x: range must be [min, max] with min < max",
    );
  });

  it(`a heatmap over ${WIDGET_LIMITS.maxHeatmapDim} x ${WIDGET_LIMITS.maxHeatmapDim}, ragged, or with mismatched labels`, () => {
    expect(errorsOf(heat({ values: Array(9).fill([1]) })).length).toBe(1);
    expect(errorsOf(heat({ values: [[1, 2], [3]] }))).toContain(
      "widget.values: widget rows must all have the same length",
    );
    expect(errorsOf(heat({ rowLabels: ["a"] }))).toContain(
      "widget.rowLabels: rowLabels needs one label per row (2)",
    );
  });

  it("a temperature without softmax-rows, or at or below 0", () => {
    const t = { min: 0.5, max: 2, step: 0.1, value: 1 };
    expect(errorsOf(heat({ temperature: t }))).toContain(
      'widget.temperature: a temperature needs transform "softmax-rows"',
    );
    expect(
      errorsOf(
        heat({ transform: "softmax-rows", temperature: { ...t, min: 0 } }),
      ),
    ).toContain("widget.temperature: temperature must be above 0");
  });

  it("an unknown kind or a missing prompt", () => {
    expect(errorsOf({ ...heat(), kind: "slider" }).length).toBeGreaterThan(0);
    expect(errorsOf({ ...heat(), prompt: "" }).length).toBeGreaterThan(0);
  });
});

describe("the panel's maths", () => {
  const w = FAKE_WIDGETS.plot;
  if (w.kind !== "plot") throw new Error();

  it("samples the formula across x at the given values", () => {
    const pts = sampleCurve(w, startValues(w))!;
    expect(pts).toHaveLength(WIDGET_LIMITS.samples);
    expect(pts[0][0]).toBe(-3);
    expect(pts.at(-1)![0]).toBe(3);
    const peak = Math.max(...pts.map(([, y]) => y));
    expect(peak).toBeCloseTo(1, 2);
    const taller = sampleCurve(w, { a: 2, b: 1 })!;
    expect(Math.max(...taller.map(([, y]) => y))).toBeCloseTo(2, 2);
  });

  it("expr evaluates to NaN/Infinity at a point: that point is NaN (skipped), no crash", () => {
    const logw = { ...w, expr: "log(x)", params: [] };
    const pts = sampleCurve(logw, {})!;
    expect(pts.filter(([x]) => x <= 0).every(([, y]) => Number.isNaN(y))).toBe(
      true,
    );
    expect(
      pts.filter(([x]) => x > 0).every(([, y]) => Number.isFinite(y)),
    ).toBe(true);
    const inv = sampleCurve({ ...w, expr: "1 / (x - x)", params: [] }, {})!;
    expect(inv.every(([, y]) => Number.isNaN(y))).toBe(true);
  });

  it("a slider starts on its step grid, as the range input shows it", () => {
    const s = { min: 0.5, max: 2, step: 0.3 };
    expect(snapToStep({ ...s, value: 1 })).toBe(1.1);
    // Rounding would pass max (1.9 -> 2.0), so it is the last step under it.
    expect(snapToStep({ ...s, max: 1.9, value: 1.9 })).toBe(1.7);
    expect(snapToStep({ min: 0.2, max: 4, step: 0.1, value: 1 })).toBe(1);
  });

  it("the y axis: the widget's own, or fitted to the starting curve with 10% padding", () => {
    expect(plotYRange(w)).toEqual([0, 3]);
    const fitted = plotYRange({ ...w, y: undefined, expr: "x", params: [] });
    expect(fitted[0]).toBeCloseTo(-3.6);
    expect(fitted[1]).toBeCloseTo(3.6);
  });

  it("softmax per row sums to 1, sharpens as the temperature drops, and is uniform on a flat row", () => {
    const rows = softmaxRows([[1, 2, 3]], 1);
    expect(rows[0].reduce((a, b) => a + b)).toBeCloseTo(1);
    const cold = softmaxRows([[1, 2, 3]], 0.1)[0];
    expect(cold[2]).toBeGreaterThan(0.99);
    expect(softmaxRows([[5, 5]], 1)[0]).toEqual([0.5, 0.5]);
    // Large scores don't overflow (the row's max is subtracted first).
    expect(softmaxRows([[1000, 1000]], 0.1)[0]).toEqual([0.5, 0.5]);
    // Nor do huge scores at a tiny temperature: no Infinity - Infinity, so no NaN.
    expect(softmaxRows([[1e308, 1]], 0.1)[0]).toEqual([1, 0]);
    expect(softmaxRows([[-1e308, -1e308]], 0.1)[0]).toEqual([0.5, 0.5]);
  });

  it("a heatmap widget shows the scores themselves without a transform", () => {
    const h = FAKE_WIDGETS.heatmap;
    if (h.kind !== "heatmap") throw new Error();
    expect(heatmapView({ ...h, transform: undefined }, [[1, 2]], 1)).toEqual([
      [1, 2],
    ]);
    expect(heatmapView(h, h.values, 1)[0][0]).toBeCloseTo(0.659, 3);
  });
});
