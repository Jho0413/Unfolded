// Heatmap and plot objects (issue #103): the schema's limits and the validator's rules for
// their targets and actions. One test per row.
import { describe, expect, it } from "vitest";
import { VIZ_STEP } from "@/app/dev/board/vizStep";
import {
  type HeatmapObject,
  type PlotObject,
  SceneObject,
  type Step,
  VIZ_LIMITS,
} from "@/shared/scene";
import { errors, type ValidationResult, validateStep } from "@/shared/validate";

const limits = { maxNarrationChars: 2000 };

const heatmap = (over: Partial<HeatmapObject> = {}): HeatmapObject => ({
  kind: "heatmap",
  id: "h",
  x: 100,
  y: 100,
  w: 400,
  h: 300,
  values: [
    [0.1, 0.9],
    [0.5, 0.5],
  ],
  ...over,
});

const plot = (over: Partial<PlotObject> = {}): PlotObject => ({
  kind: "plot",
  id: "p",
  x: 700,
  y: 100,
  w: 600,
  h: 400,
  xRange: [0, 1],
  yRange: [0, 1],
  series: [
    {
      points: [
        [0, 0],
        [0.5, 0.25],
        [1, 1],
      ],
    },
    {
      points: [
        [0, 1],
        [1, 0],
      ],
      style: "points",
    },
  ],
  ...over,
});

function step(actions: Record<string, unknown>[] = [], objects?: unknown[]) {
  return {
    title: "Viz",
    narration: "Look [[one]]here.",
    objects: objects ?? [heatmap(), plot()],
    actions: actions.map((a) => ({ cue: "one", durationMs: 400, ...a })),
  } as Step;
}

function expectValid<T>(r: ValidationResult<T>): void {
  if (!r.ok) throw new Error(`expected valid, got ${JSON.stringify(r.errors)}`);
}

/** The step's errors, schema or rule. */
function errorsOf(input: unknown): string[] {
  const r = validateStep(input, limits);
  return r.ok ? [] : r.errors;
}

const schemaError = (obj: unknown) => {
  const r = SceneObject.safeParse(obj);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("heatmap and plot schema", () => {
  it("the fixture step and a minimal heatmap and plot are valid", () => {
    expectValid(validateStep(VIZ_STEP, limits));
    expectValid(validateStep(step(), limits));
  });

  it("heatmap: ragged rows are rejected", () => {
    expect(schemaError(heatmap({ values: [[1, 2], [3]] }))).toContain(
      "heatmap rows must all have the same length",
    );
  });

  it("heatmap: empty values is an issue, not a TypeError", () => {
    expect(() => schemaError(heatmap({ values: [] }))).not.toThrow();
    expect(schemaError(heatmap({ values: [] })).length).toBeGreaterThan(0);
  });

  it(`heatmap: more than ${VIZ_LIMITS.maxHeatmapDim} rows or columns is rejected`, () => {
    const big = VIZ_LIMITS.maxHeatmapDim + 1;
    expect(
      SceneObject.safeParse(heatmap({ values: [Array(big).fill(0)] })).success,
    ).toBe(false);
    expect(
      SceneObject.safeParse(heatmap({ values: Array(big).fill([0]) })).success,
    ).toBe(false);
  });

  it("heatmap: non-finite values are rejected", () => {
    const bad = JSON.parse('{"v": null}').v as number;
    expect(
      SceneObject.safeParse(heatmap({ values: [[Infinity, 1]] })).success,
    ).toBe(false);
    expect(SceneObject.safeParse(heatmap({ values: [[bad, 1]] })).success).toBe(
      false,
    );
  });

  it("heatmap: labels must match the rows and columns", () => {
    expect(schemaError(heatmap({ rowLabels: ["a"] }))).toContain(
      "rowLabels needs one label per row (2)",
    );
    expect(schemaError(heatmap({ colLabels: ["a", "b", "c"] }))).toContain(
      "colLabels needs one label per column (2)",
    );
  });

  it("heatmap: scale min must be below max", () => {
    expect(schemaError(heatmap({ scale: { min: 1, max: 1 } }))).toContain(
      "scale.min must be less than scale.max",
    );
  });

  it(`heatmap and plot: a box under ${VIZ_LIMITS.minSize} is rejected`, () => {
    expect(SceneObject.safeParse(heatmap({ w: 50 })).success).toBe(false);
    expect(SceneObject.safeParse(plot({ h: 50 })).success).toBe(false);
  });

  it("plot: a range must be [min, max] with min < max", () => {
    expect(schemaError(plot({ xRange: [1, 0] }))).toContain(
      "range must be [min, max] with min < max",
    );
    expect(SceneObject.safeParse(plot({ yRange: [0] })).success).toBe(false);
  });

  it(`plot: 1..${VIZ_LIMITS.maxSeries} series of 2..${VIZ_LIMITS.maxPoints} points`, () => {
    const s = plot().series[0];
    expect(SceneObject.safeParse(plot({ series: [] })).success).toBe(false);
    expect(
      SceneObject.safeParse(
        plot({ series: Array(VIZ_LIMITS.maxSeries + 1).fill(s) }),
      ).success,
    ).toBe(false);
    expect(
      SceneObject.safeParse(plot({ series: [{ points: [[0, 0]] }] })).success,
    ).toBe(false);
    const many = Array.from({ length: VIZ_LIMITS.maxPoints + 1 }, (_, i) => [
      i,
      0,
    ]);
    expect(
      SceneObject.safeParse(plot({ series: [{ points: many }] })).success,
    ).toBe(false);
  });

  it("plot: a point must be two numbers", () => {
    expect(
      SceneObject.safeParse(plot({ series: [{ points: [[0, 0, 0], [1]] }] }))
        .success,
    ).toBe(false);
  });

  it("plot: a line series' x must not decrease; a points series may", () => {
    const back = [
      [1, 0],
      [0, 1],
    ];
    expect(schemaError(plot({ series: [{ points: back }] }))).toContain(
      "a line series' x values must not decrease (it draws on along x)",
    );
    expect(
      SceneObject.safeParse(
        plot({ series: [{ points: back, style: "points" }] }),
      ).success,
    ).toBe(true);
  });

  it("too small: a box whose labels leave cells under 20 px or a plot area under 80 px is rejected", () => {
    const long = "x".repeat(24);
    expect(
      errorsOf(step([], [heatmap({ w: 120, rowLabels: [long, long] })])),
    ).toEqual([errors.tooSmall("h")]);
    expect(
      errorsOf(
        step(
          [],
          [plot({ w: 120, yRange: [0, 1e9], xLabel: "x", yLabel: "y" })],
        ),
      ),
    ).toEqual([errors.tooSmall("p")]);
  });

  it("plot: a range too narrow for its magnitude is rejected (its ticks can't be told apart)", () => {
    expect(schemaError(plot({ yRange: [1e16, 1e16 + 2] }))).toContain(
      "range is too narrow for its size (shift the data nearer 0)",
    );
    expect(SceneObject.safeParse(plot({ yRange: [-1e-6, 1e-6] })).success).toBe(
      true,
    );
  });

  it("off canvas: a heatmap or plot box past the canvas is rejected", () => {
    expect(errorsOf(step([], [heatmap({ x: 1400 })]))).toContain(
      errors.offCanvas("h"),
    );
    expect(errorsOf(step([], [plot({ y: 600 })]))).toContain(
      errors.offCanvas("p"),
    );
  });
});

describe("heatmap and plot actions", () => {
  it("heatmap: show, hide and highlight on a row, column or cell are valid", () => {
    expectValid(
      validateStep(
        step([
          { do: "show", target: { id: "h", row: 1 } },
          { do: "show", target: { id: "h", col: 0 } },
          { do: "hide", target: { id: "h", row: 0, col: 1 } },
          { do: "highlight", target: { id: "h", row: 0, col: 1 } },
          { do: "unhighlight", target: { id: "h", col: 1 } },
        ]),
        limits,
      ),
    );
  });

  it("plot: show on a series, highlight on a series or a point are valid", () => {
    expectValid(
      validateStep(
        step([
          { do: "show", target: { id: "p", row: 1 } },
          { do: "highlight", target: { id: "p", row: 0 } },
          { do: "highlight", target: { id: "p", row: 0, col: 2 } },
          { do: "move", target: { id: "p" }, to: { x: 900, y: 400 } },
        ]),
        limits,
      ),
    );
  });

  it("heatmap: a row or column past the grid is out of range", () => {
    expect(
      errorsOf(step([{ do: "show", target: { id: "h", row: 2 } }])),
    ).toEqual([errors.targetOutOfRange("h")]);
    expect(
      errorsOf(step([{ do: "highlight", target: { id: "h", col: 2 } }])),
    ).toEqual([errors.targetOutOfRange("h")]);
  });

  it("plot: a series or point past the plot is out of range, by its own series' length", () => {
    expect(
      errorsOf(step([{ do: "show", target: { id: "p", row: 2 } }])),
    ).toEqual([errors.targetOutOfRange("p")]);
    // Series 1 has 2 points, series 0 has 3.
    expect(
      errorsOf(
        step([{ do: "highlight", target: { id: "p", row: 1, col: 2 } }]),
      ),
    ).toEqual([errors.targetOutOfRange("p")]);
    // A point needs its series.
    expect(
      errorsOf(step([{ do: "highlight", target: { id: "p", col: 0 } }])),
    ).toEqual([errors.targetOutOfRange("p")]);
  });

  it("plot: show or hide on a point is rejected (they draw a whole series)", () => {
    expect(
      errorsOf(step([{ do: "show", target: { id: "p", row: 0, col: 1 } }])),
    ).toEqual([errors.needsSeries("show", "p")]);
    expect(
      errorsOf(step([{ do: "hide", target: { id: "p", row: 0, col: 0 } }])),
    ).toEqual([errors.needsSeries("hide", "p")]);
    expectValid(
      validateStep(step([{ do: "hide", target: { id: "p", row: 0 } }]), limits),
    );
  });

  it("an anchor past a heatmap's grid or a plot's series is out of range; a plot point needs its series", () => {
    const arrow = (to: Record<string, number | string>) =>
      errorsOf(
        step(
          [],
          [
            heatmap(),
            plot(),
            { kind: "arrow", id: "a", from: { x: 1, y: 1 }, to },
          ],
        ),
      );
    expect(arrow({ id: "h", row: 99 })).toEqual([errors.targetOutOfRange("h")]);
    expect(arrow({ id: "p", row: 1, col: 5 })).toEqual([
      errors.targetOutOfRange("p"),
    ]);
    expect(arrow({ id: "p", col: 0 })).toEqual([errors.targetOutOfRange("p")]);
    expect(
      errorsOf(
        step([
          { do: "move", target: { id: "h" }, to: { id: "p", row: 0, col: 3 } },
        ]),
      ),
    ).toEqual([errors.targetOutOfRange("p")]);
  });

  it("heatmap and plot: write is rejected", () => {
    expect(
      errorsOf(
        step([
          { do: "write", target: { id: "h", row: 0, col: 0 }, value: "1" },
        ]),
      ),
    ).toEqual([errors.cantWrite("h")]);
    expect(
      errorsOf(step([{ do: "write", target: { id: "p" }, value: "1" }])),
    ).toEqual([errors.cantWrite("p")]);
  });

  it("heatmap and plot: a part can't move (only the whole object)", () => {
    expect(
      errorsOf(
        step([{ do: "move", target: { id: "h", row: 0 }, to: { x: 1, y: 1 } }]),
      ),
    ).toEqual([errors.cantMove("h")]);
    expect(
      errorsOf(
        step([{ do: "move", target: { id: "p", row: 0 }, to: { x: 1, y: 1 } }]),
      ),
    ).toEqual([errors.cantMove("p")]);
  });

  it("an arrow may point at a heatmap cell or a plot point", () => {
    expectValid(
      validateStep(
        step(
          [],
          [
            heatmap(),
            plot(),
            {
              kind: "arrow",
              id: "a",
              from: { id: "h", row: 0, col: 1 },
              to: { id: "p", row: 0, col: 1 },
            },
          ],
        ),
        limits,
      ),
    );
  });
});
