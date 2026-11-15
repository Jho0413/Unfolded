// lib/pipeline/outputFormat.ts: the wire format Claude fills in (#57, ARCHITECTURE.md
// sections 4 and 5.1). One test per conversion row, named after it, plus round trips: every
// valid shared Step or Sketch, parsed as wire, comes back identical, and every field of every
// contract action is on the wire, so the two can't drift apart.
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { config } from "@/lib/config";
import { readFixture } from "@/lib/fakes";
import {
  JsonStepObject,
  JsonWidget,
  SKETCH_OUTPUT_FORMAT,
  STEP_OUTPUT_FORMAT,
  validateWireSketch,
  validateWireStep,
  WireSketch,
  WireStep,
  WireStepObject,
  wireErrors,
  wireToSketch,
  wireToStep,
} from "@/lib/pipeline/outputFormat";
import {
  type BoardState,
  CuedAction,
  MAX_DURATION_MS,
  MAX_PAPER_QUOTE_CHARS,
  SceneObject,
  Sketch,
  Step,
} from "@/shared/scene";
import { Widget } from "@/shared/widget";
import { ANSWER_TEMPLATE, errors } from "@/shared/validate";

/** A narrated answer's narration (#105): its one cue, "c", fires on the first word. */
const SAID = "[[c]]Here it is.";

const LIMITS = { maxNarrationChars: config.maxNarrationChars };

const isJsonObject = (o: SceneObject): o is JsonStepObject =>
  JsonStepObject.options.some((k) => k.shape.kind.value === o.kind);

/**
 * A parsed contract step as wire: the heatmap, plot and image objects as JSON text, the rest in
 * the grammar. This compiles only while every contract action kind and field type fits the
 * wire; a new field is caught by the field-coverage tests below.
 */
const stepToWire = ({ widget, ...step }: Step): WireStep => ({
  ...step,
  objects: step.objects.filter((o): o is WireStepObject => !isJsonObject(o)),
  objectsJson: JSON.stringify(step.objects.filter(isJsonObject)),
  ...(widget && { widgetJson: JSON.stringify(widget) }),
});
const sketchToWire = (sketch: Sketch): WireSketch => sketch;

// ------------------------------------------------------------ arbitraries

const id = fc.stringMatching(/^[a-z][a-z0-9_]{0,31}$/);
const cue = id;
const coord = fc.integer({ min: 0, max: 1600 });
const index = fc.nat({ max: 7 });
const target = fc.record(
  { id, row: index, col: index },
  { requiredKeys: ["id"] },
);
const point = fc.record({ x: coord, y: coord });
const anchor = fc.oneof(target, point);
const hidden = { hidden: fc.boolean() };
const cell = fc.string({ maxLength: 3 });

/** The objects a step's grammar carries. */
const wireObject = fc.oneof(
  fc.integer({ min: 1, max: 8 }).chain((cols) =>
    fc.record(
      {
        kind: fc.constant("matrix" as const),
        id,
        x: coord,
        y: coord,
        rows: fc.array(fc.array(cell, { minLength: cols, maxLength: cols }), {
          minLength: 1,
          maxLength: 8,
        }),
        label: fc.string(),
        ...hidden,
      },
      { requiredKeys: ["kind", "id", "x", "y", "rows"] },
    ),
  ),
  fc.record(
    {
      kind: fc.constant("text" as const),
      id,
      x: coord,
      y: coord,
      text: fc.string(),
      size: fc.constantFrom("s" as const, "m" as const, "l" as const),
      ...hidden,
    },
    { requiredKeys: ["kind", "id", "x", "y", "text"] },
  ),
  fc.record(
    {
      kind: fc.constant("latex" as const),
      id,
      x: coord,
      y: coord,
      tex: fc.string(),
      ...hidden,
    },
    { requiredKeys: ["kind", "id", "x", "y", "tex"] },
  ),
  fc.record(
    {
      kind: fc.constant("arrow" as const),
      id,
      from: anchor,
      to: anchor,
      label: fc.string(),
      ...hidden,
    },
    { requiredKeys: ["kind", "id", "from", "to"] },
  ),
);

const image = fc.record(
  {
    kind: fc.constant("image" as const),
    id,
    x: coord,
    y: coord,
    w: fc.integer({ min: 1, max: 800 }),
    h: fc.integer({ min: 1, max: 800 }),
    prompt: fc.string({ minLength: 1 }),
    ...hidden,
  },
  { requiredKeys: ["kind", "id", "x", "y", "w", "h", "prompt"] },
);

/** Every board object a sketch can draw. */
const boardObject = fc.oneof(wireObject, image);

/** A finite number as JSON gives it back (no -0, which JSON writes as 0). */
const value = fc
  .double({ min: -1e6, max: 1e6, noNaN: true })
  .map((v) => (Object.is(v, -0) ? 0 : v));
const vizSize = fc.integer({ min: 120, max: 800 });
const vizLabel = fc.string({ minLength: 1, maxLength: 24 });

const heatmap = fc
  .tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 12 }))
  .chain(([rows, cols]) =>
    fc.record(
      {
        kind: fc.constant("heatmap" as const),
        id,
        x: coord,
        y: coord,
        w: vizSize,
        h: vizSize,
        values: fc.array(
          fc.array(value, { minLength: cols, maxLength: cols }),
          {
            minLength: rows,
            maxLength: rows,
          },
        ),
        rowLabels: fc.array(vizLabel, { minLength: rows, maxLength: rows }),
        colLabels: fc.array(vizLabel, { minLength: cols, maxLength: cols }),
        scale: fc.record({ min: fc.constant(0), max: fc.constant(1) }),
        showValues: fc.boolean(),
        cellsHidden: fc.boolean(),
        label: fc.string(),
        ...hidden,
      },
      { requiredKeys: ["kind", "id", "x", "y", "w", "h", "values"] },
    ),
  );

/** A line series' points: x never decreases. */
const linePoints = fc
  .array(fc.tuple(value, value), { minLength: 2, maxLength: 20 })
  .map((ps) => ps.map(([x, y]) => [x, y]).sort((a, b) => a[0] - b[0]));

const plot = fc.record(
  {
    kind: fc.constant("plot" as const),
    id,
    x: coord,
    y: coord,
    w: vizSize,
    h: vizSize,
    xRange: fc.constant([-6, 6]),
    yRange: fc.constant([0, 1]),
    series: fc.array(
      fc.record(
        {
          points: linePoints,
          label: vizLabel,
          style: fc.constant("line" as const),
          hidden: fc.boolean(),
        },
        { requiredKeys: ["points"] },
      ),
      { minLength: 1, maxLength: 4 },
    ),
    xLabel: vizLabel,
    yLabel: vizLabel,
    ...hidden,
  },
  {
    requiredKeys: [
      "kind",
      "id",
      "x",
      "y",
      "w",
      "h",
      "xRange",
      "yRange",
      "series",
    ],
  },
);

/** The objects a step's wire carries as JSON text. */
const jsonObject = fc.oneof(heatmap, plot, image);

const durationMs = fc.integer({ min: 0, max: MAX_DURATION_MS });
const color = fc.constantFrom("accent" as const, "warn" as const);

/** Every contract action kind, each with only the fields it takes. */
const action = fc.oneof(
  fc.record({
    do: fc.constantFrom("show" as const, "hide" as const),
    target,
    durationMs,
  }),
  fc.record(
    {
      do: fc.constantFrom("highlight" as const, "unhighlight" as const),
      target,
      color,
      durationMs,
    },
    { requiredKeys: ["do", "target", "durationMs"] },
  ),
  fc.record({
    do: fc.constant("move" as const),
    target,
    to: anchor,
    durationMs,
  }),
  fc.record({
    do: fc.constant("write" as const),
    target,
    value: fc.string(),
    durationMs,
  }),
);

/** A contract paper ref (#98), with or without its optional fields. */
const paperRef = fc.record(
  {
    page: fc.integer({ min: 1, max: 600 }),
    quote: fc.string({ minLength: 1, maxLength: MAX_PAPER_QUOTE_CHARS }),
    label: fc.string({ minLength: 1 }),
    cue,
  },
  { requiredKeys: ["page", "quote"] },
);

const widgetPrompt = fc.string({ minLength: 1, maxLength: 160 });
const sliderOf = (min: number, max: number) =>
  fc.record({
    min: fc.constant(min),
    max: fc.constant(max),
    step: fc.constant(0.1),
    value: fc.double({ min, max, noNaN: true }),
  });

/** Schema-valid widgets of both kinds (#110), optional fields present or not. */
const widget = fc.oneof(
  fc.record(
    {
      kind: fc.constant("plot" as const),
      prompt: widgetPrompt,
      expr: fc.constantFrom("a * x", "a * exp(-b * x^2)", "sin(x)"),
      x: fc.constant([-3, 3]),
      y: fc.constant([0, 3]),
      params: fc.array(
        fc.tuple(id, sliderOf(0, 2)).map(([name, s]) => ({
          name: name.slice(0, 16),
          label: "a knob",
          ...s,
        })),
        { maxLength: 4 },
      ),
      xLabel: vizLabel,
      yLabel: vizLabel,
    },
    { requiredKeys: ["kind", "prompt", "expr", "x", "params"] },
  ),
  fc
    .tuple(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 8 }))
    .chain(([rows, cols]) =>
      fc.record(
        {
          kind: fc.constant("heatmap" as const),
          prompt: widgetPrompt,
          values: fc.array(
            fc.array(value, { minLength: cols, maxLength: cols }),
            { minLength: rows, maxLength: rows },
          ),
          rowLabels: fc.array(vizLabel, { minLength: rows, maxLength: rows }),
          colLabels: fc.array(vizLabel, { minLength: cols, maxLength: cols }),
          // A temperature needs softmax-rows: both, softmax-rows alone, or neither.
          softmax: fc.option(
            fc.record(
              {
                transform: fc.constant("softmax-rows" as const),
                temperature: sliderOf(0.1, 3),
              },
              { requiredKeys: ["transform"] },
            ),
            { nil: undefined },
          ),
        },
        { requiredKeys: ["kind", "prompt", "values", "softmax"] },
      ),
    )
    .map(({ softmax, ...w }) => ({ ...w, ...softmax })),
);

/**
 * Schema-valid contract steps, as Step.parse returns them (defaults filled in). paperRefs is
 * absent or non-empty: an empty list isn't kept (wireToStep).
 */
const step = fc
  .record(
    {
      title: fc.string({ minLength: 1 }),
      narration: fc.string({ minLength: 1 }),
      // As wireToStep orders them: the JSON objects first.
      objects: fc
        .tuple(
          fc.array(jsonObject, { maxLength: 3 }),
          fc.array(wireObject, { maxLength: 5 }),
        )
        .map(([json, grammar]) => [...json, ...grammar]),
      actions: fc.array(
        action.chain((a) => cue.map((c) => ({ ...a, cue: c }))),
        { maxLength: 8 },
      ),
      paperRefs: fc.array(paperRef, { minLength: 1, maxLength: 3 }),
      widget,
    },
    { requiredKeys: ["title", "narration", "objects", "actions"] },
  )
  .map((s) => Step.parse(s));

const sketch = fc
  .record({
    narration: fc.string({ minLength: 1 }),
    objects: fc.array(boardObject, { maxLength: 5 }),
    actions: fc.array(
      action.chain((a) => cue.map((c) => ({ ...a, cue: c }))),
      { maxLength: 8 },
    ),
  })
  .map((s) => Sketch.parse(s));

/** Any wire action: every field of the flat object present or not, whatever `do` is. */
const wireAction = fc.record(
  {
    do: fc.constantFrom(
      "show" as const,
      "hide" as const,
      "highlight" as const,
      "unhighlight" as const,
      "move" as const,
      "write" as const,
    ),
    target,
    durationMs,
    color,
    to: anchor,
    value: fc.string(),
    cue,
  },
  { requiredKeys: ["do", "target", "durationMs", "cue"] },
);

// ------------------------------------------------------------ fixtures

let demo: Step;
beforeAll(async () => {
  demo = Step.parse(await readFixture("demo-m1.step.json"));
});

const EMPTY_BOARD: BoardState = { objects: [], copies: [], active: [] };

/** A one-action wire step on a 2x2 matrix `a`, whose narration has the marker [[go]]. */
function wireStepWith(...actions: WireStep["actions"]): WireStep {
  return {
    title: "A step",
    narration: "Watch [[go]]this.",
    objects: [
      {
        kind: "matrix",
        id: "a",
        x: 100,
        y: 100,
        rows: [
          ["1", "2"],
          ["3", "4"],
        ],
      },
    ],
    objectsJson: "[]",
    actions,
  };
}

// ------------------------------------------------------------ round trips

describe("round trip: contract -> wire -> contract", () => {
  it("the M1 demo step comes back identical, with no errors", () => {
    expect(wireToStep(stepToWire(demo))).toStrictEqual({
      value: demo,
      errors: [],
    });
  });

  it("the M1 demo step stays valid through validateWireStep", () => {
    expect(validateWireStep(stepToWire(demo), LIMITS)).toStrictEqual({
      ok: true,
      value: demo,
    });
  });

  it("a step with every action kind, and highlight with and without color, comes back identical", () => {
    const every = Step.parse(
      wireStepWith(
        { do: "show", target: { id: "a" }, durationMs: 0, cue: "go" },
        { do: "hide", target: { id: "a" }, durationMs: 400, cue: "go" },
        {
          do: "highlight",
          target: { id: "a", row: 0 },
          durationMs: 400,
          cue: "go",
        },
        {
          do: "unhighlight",
          target: { id: "a", col: 1 },
          color: "warn",
          durationMs: 400,
          cue: "go",
        },
        {
          do: "move",
          target: { id: "a", row: 1, col: 1 },
          to: { x: 500, y: 500 },
          durationMs: 3000,
          cue: "go",
        },
        {
          do: "write",
          target: { id: "a", row: 0, col: 0 },
          value: "7",
          durationMs: 400,
          cue: "go",
        },
      ),
    );
    expect(wireToStep(stepToWire(every))).toStrictEqual({
      value: every,
      errors: [],
    });
  });

  it("every schema-valid Step comes back identical, with no errors (property)", () => {
    fc.assert(
      fc.property(step, (s) => {
        expect(wireToStep(WireStep.parse(stepToWire(s)))).toStrictEqual({
          value: s,
          errors: [],
        });
      }),
    );
  });

  it("every schema-valid Sketch comes back identical, with no errors (property)", () => {
    fc.assert(
      fc.property(sketch, (s) => {
        expect(wireToSketch(WireSketch.parse(sketchToWire(s)))).toStrictEqual({
          value: s,
          errors: [],
        });
      }),
    );
  });

  it("any wire step converts every action but the moves without to and writes without value, with one error per such target (property)", () => {
    fc.assert(
      fc.property(fc.array(wireAction, { maxLength: 10 }), (actions) => {
        const { value, errors: errs } = wireToStep(wireStepWith(...actions));
        const bad = actions.filter(
          (a) =>
            (a.do === "move" && a.to === undefined) ||
            (a.do === "write" && a.value === undefined),
        );
        expect(value.actions).toHaveLength(actions.length - bad.length);
        expect(errs).toEqual([
          ...new Set(
            bad.map((a) =>
              a.do === "move"
                ? wireErrors.moveNeedsTo(a.target.id)
                : wireErrors.writeNeedsValue(a.target.id),
            ),
          ),
        ]);
        // What converts is a contract step.
        expect(Step.safeParse(value).success).toBe(true);
      }),
    );
  });
});

// ------------------------------------------------------------ field coverage

/** Every field of every member of a contract action union. */
function contractFields(union: typeof CuedAction) {
  return new Set(union.options.flatMap((o) => Object.keys(o.shape)));
}
function contractKinds(union: typeof CuedAction) {
  return new Set(union.options.map((o) => o.shape.do.value));
}

describe("field coverage: the wire has every contract action field and kind", () => {
  it("every field of every contract step action is a wire step action field", () => {
    const wire = WireStep.shape.actions.element;
    expect(new Set(Object.keys(wire.shape))).toEqual(
      contractFields(CuedAction),
    );
    expect(new Set(wire.shape.do.options)).toEqual(contractKinds(CuedAction));
  });

  it("every field of every contract sketch action is a wire sketch action field", () => {
    const wire = WireSketch.shape.actions.element;
    expect(new Set(Object.keys(wire.shape))).toEqual(
      contractFields(CuedAction),
    );
    expect(new Set(wire.shape.do.options)).toEqual(contractKinds(CuedAction));
  });

  it("the wire step and sketch have the contract's top-level fields", () => {
    // objectsJson and widgetJson carry the objects and the widget the grammar has no room for.
    expect(Object.keys(WireStep.shape).sort()).toEqual(
      [
        ...Object.keys(Step.shape).filter((k) => k !== "widget"),
        "objectsJson",
        "widgetJson",
      ].sort(),
    );
    expect(Object.keys(WireSketch.shape).sort()).toEqual(
      Object.keys(Sketch.shape).sort(),
    );
  });
});

describe("field coverage: every contract object kind is on the wire step once", () => {
  const kinds = (u: {
    options: readonly { shape: { kind: { value: string } } }[];
  }) => u.options.map((o) => o.shape.kind.value);

  it("each scene object kind is in the grammar or in objectsJson, never both", () => {
    const grammar = kinds(WireStepObject);
    const json = kinds(JsonStepObject);
    expect([...grammar, ...json].sort()).toEqual(kinds(SceneObject).sort());
    expect(grammar.filter((k) => json.includes(k))).toEqual([]);
  });

  it("the grammar's objects are the contract's own schemas, and so are objectsJson's", () => {
    const byKind = new Map(
      SceneObject.options.map((o) => [o.shape.kind.value, o]),
    );
    for (const o of [...WireStepObject.options, ...JsonStepObject.options])
      expect(o).toBe(byKind.get(o.shape.kind.value));
  });
});

// ------------------------------------------------------------ conversion rows

describe("widgetJson (#110): one test per row", () => {
  const PLOT_WIDGET = {
    kind: "plot",
    prompt: "Try it yourself: move a.",
    expr: "a * x",
    x: [-1, 1],
    params: [
      { name: "a", label: "slope", min: 0, max: 2, step: 0.1, value: 1 },
    ],
  } as const;
  const HEATMAP_WIDGET = {
    kind: "heatmap",
    prompt: "Try it yourself: change a score.",
    values: [
      [1, 2],
      [3, 4],
    ],
    transform: "softmax-rows",
    temperature: { min: 0.1, max: 3, step: 0.1, value: 1 },
  } as const;
  const withWidget = (widgetJson?: string): WireStep => ({
    ...wireStepWith(),
    ...(widgetJson !== undefined && { widgetJson }),
  });

  it("absent: no widget, no errors", () => {
    const { value, errors: errs } = wireToStep(withWidget());
    expect(value).not.toHaveProperty("widget");
    expect(errs).toEqual([]);
  });

  it("blank (empty or whitespace): no widget, no errors", () => {
    for (const blank of ["", " \n"]) {
      const { value, errors: errs } = wireToStep(withWidget(blank));
      expect(value).not.toHaveProperty("widget");
      expect(errs).toEqual([]);
    }
  });

  it("a plot widget: the step's widget, its params as given", () => {
    const { value, errors: errs } = wireToStep(
      withWidget(JSON.stringify(PLOT_WIDGET)),
    );
    expect(errs).toEqual([]);
    expect(value.widget).toStrictEqual(PLOT_WIDGET);
  });

  it("a heatmap widget: the step's widget", () => {
    const result = validateWireStep(
      withWidget(JSON.stringify(HEATMAP_WIDGET)),
      LIMITS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.widget).toStrictEqual(HEATMAP_WIDGET);
  });

  it("a plot widget without params: params default to none, as the contract's do", () => {
    // JSON.stringify leaves out an undefined field.
    const { value } = wireToStep(
      withWidget(
        JSON.stringify({ ...PLOT_WIDGET, expr: "x", params: undefined }),
      ),
    );
    expect(value.widget).toStrictEqual({
      ...PLOT_WIDGET,
      expr: "x",
      params: [],
    });
  });

  it("not JSON: rejected with widgetJson: not valid JSON, and no widget", () => {
    const { value, errors: errs } = wireToStep(withWidget('{"kind": "plot",'));
    expect(value).not.toHaveProperty("widget");
    expect(errs).toEqual([
      expect.stringMatching(/^widgetJson: not valid JSON \(.+\)$/),
    ]);
  });

  it("JSON that fails the widget schema (an unknown kind, a missing prompt, a temperature without softmax-rows): rejected with its widgetJson path, no widget", () => {
    // JSON.stringify leaves out an undefined field.
    const noTransform = { ...HEATMAP_WIDGET, transform: undefined };
    const noPrompt = { ...PLOT_WIDGET, prompt: undefined };
    for (const [bad, path] of [
      [{ ...PLOT_WIDGET, kind: "slider" }, /^widgetJson\.kind: /],
      [noPrompt, /^widgetJson\.prompt: /],
      [noTransform, /^widgetJson\.temperature: /],
      [[PLOT_WIDGET], /^widgetJson: /],
      [
        { ...PLOT_WIDGET, params: [{ ...PLOT_WIDGET.params[0], value: 9 }] },
        /^widgetJson\.params\.0: a slider needs/,
      ],
    ] as const) {
      const { value, errors: errs } = wireToStep(
        withWidget(JSON.stringify(bad)),
      );
      expect(value).not.toHaveProperty("widget");
      expect(errs).toEqual([expect.stringMatching(path)]);
    }
  });

  it("a widget the contract rejects (an expr with an unknown name): validateStep's named error, for the retry", () => {
    const result = validateWireStep(
      withWidget(JSON.stringify({ ...PLOT_WIDGET, expr: "a * y" })),
      LIMITS,
    );
    expect(result).toStrictEqual({
      ok: false,
      errors: [expect.stringMatching(/^widget expr: unknown name "y"/)],
    });
  });

  it("a widget with a reserved param name: validateStep's named error, for the retry", () => {
    const pi = { ...PLOT_WIDGET.params[0], name: "pi" };
    const result = validateWireStep(
      withWidget(JSON.stringify({ ...PLOT_WIDGET, expr: "x", params: [pi] })),
      LIMITS,
    );
    expect(result).toStrictEqual({
      ok: false,
      errors: [expect.stringMatching(/^widget param: reserved name "pi"/)],
    });
  });

  it("widgetJson reads every kind of the contract's Widget, with its own schema", () => {
    expect(JsonWidget.options).toEqual(Widget.options);
  });

  it("widgetJson's errors come back with objectsJson's and the actions', in one list", () => {
    const result = validateWireStep(
      {
        ...wireStepWith({
          do: "move",
          target: { id: "a" },
          durationMs: 400,
          cue: "go",
        }),
        objectsJson: "[",
        widgetJson: "{",
      },
      LIMITS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toEqual([
        expect.stringMatching(/^objectsJson: not valid JSON/),
        wireErrors.moveNeedsTo("a"),
        expect.stringMatching(/^widgetJson: not valid JSON/),
      ]);
  });
});

describe("wireToStep: paperRefs (#98), one test per row", () => {
  const REF = { page: 2, quote: "A sentence.", label: "Eq. 1", cue: "go" };

  it("present: kept as they are", () => {
    const { value, errors: errs } = wireToStep({
      ...wireStepWith(),
      paperRefs: [REF],
    });
    expect(value.paperRefs).toEqual([REF]);
    expect(errs).toEqual([]);
  });

  it("an empty list: not kept, so the step has no paperRefs", () => {
    const { value } = wireToStep({ ...wireStepWith(), paperRefs: [] });
    expect(value).not.toHaveProperty("paperRefs");
  });

  it("absent: still absent", () => {
    expect(wireToStep(wireStepWith()).value).not.toHaveProperty("paperRefs");
  });

  it("a malformed ref (an empty or over-long quote, page 0, an empty label, a bad cue): dropped with a warning naming it, not an error", () => {
    const bad = [
      { page: 2, quote: "" },
      { page: 2, quote: "x".repeat(MAX_PAPER_QUOTE_CHARS + 1) },
      { page: 0, quote: "A sentence." },
      { page: 2, quote: "A sentence.", label: "" },
      { page: 2, quote: "A sentence.", cue: "Not A Cue" },
    ];
    const converted = wireToStep({
      ...wireStepWith(),
      paperRefs: [REF, ...bad],
    });
    expect(converted.value.paperRefs).toEqual([REF]);
    expect(converted.errors).toEqual([]);
    expect(converted.warnings).toHaveLength(bad.length);
    bad.forEach((_, i) =>
      expect(converted.warnings?.[i]).toMatch(
        new RegExp(`^paperRefs\\.${i + 1} dropped: `),
      ),
    );
  });

  it("validateWireStep: a malformed ref leaves the step valid, its warning to log", () => {
    const result = validateWireStep(
      { ...wireStepWith(), paperRefs: [REF, { page: 0, quote: "x" }] },
      LIMITS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.paperRefs).toEqual([REF]);
      expect(result.warnings).toEqual([
        expect.stringMatching(/^paperRefs\.1 dropped: /),
      ]);
    }
  });
});

/** A cells-hidden 2x2 heatmap `w` and a one-series plot `p`, valid against the contract. */
const HEATMAP = {
  kind: "heatmap",
  id: "w",
  x: 300,
  y: 200,
  w: 400,
  h: 400,
  values: [
    [0.7, 0.3],
    [0.2, 0.8],
  ],
  rowLabels: ["a", "b"],
  colLabels: ["a", "b"],
  scale: { min: 0, max: 1 },
  cellsHidden: true,
} as const;
const PLOT = {
  kind: "plot",
  id: "p",
  x: 900,
  y: 200,
  w: 500,
  h: 400,
  xRange: [-1, 1],
  yRange: [0, 1],
  series: [
    {
      points: [
        [-1, 0],
        [0, 0.5],
        [1, 1],
      ],
      hidden: true,
    },
  ],
} as const;

describe("objectsJson: one test per row", () => {
  const withJson = (objectsJson: string, ...actions: WireStep["actions"]) => ({
    ...wireStepWith(...actions),
    objectsJson,
  });

  it('"[]": no more objects, no errors', () => {
    const { value, errors: errs } = wireToStep(withJson("[]"));
    expect(value.objects.map((o) => o.id)).toEqual(["a"]);
    expect(errs).toEqual([]);
  });

  it("blank (empty or whitespace): no more objects, as for []", () => {
    for (const blank of ["", "  \n "]) {
      const { value, errors: errs } = wireToStep(withJson(blank));
      expect(value.objects.map((o) => o.id)).toEqual(["a"]);
      expect(errs).toEqual([]);
    }
  });

  it("an array of heatmap, plot and image objects: the step's first objects, in order, before objects", () => {
    const image = {
      kind: "image",
      id: "img",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      prompt: "a cat",
    };
    const { value, errors: errs } = wireToStep(
      withJson(JSON.stringify([PLOT, HEATMAP, image])),
    );
    expect(errs).toEqual([]);
    expect(value.objects).toStrictEqual([
      PLOT,
      HEATMAP,
      image,
      wireStepWith().objects[0],
    ]);
  });

  it("not JSON: rejected with objectsJson: not valid JSON, and no more objects", () => {
    const { value, errors: errs } = wireToStep(withJson('[{"kind": "plot",'));
    expect(value.objects.map((o) => o.id)).toEqual(["a"]);
    expect(errs).toEqual([
      expect.stringMatching(/^objectsJson: not valid JSON \(.+\)$/),
    ]);
  });

  it("an id in objectsJson and in objects is a duplicate: ids are shared", () => {
    const result = validateWireStep(
      withJson(JSON.stringify([{ ...HEATMAP, id: "a" }])),
      LIMITS,
    );
    expect(result).toStrictEqual({
      ok: false,
      errors: [errors.duplicateId("a")],
    });
  });

  it("JSON but not an array: rejected with objectsJson: must be a JSON array", () => {
    const { value, errors: errs } = wireToStep(
      withJson(JSON.stringify(HEATMAP)),
    );
    expect(value.objects.map((o) => o.id)).toEqual(["a"]);
    expect(errs).toEqual([wireErrors.objectsJsonNotArray]);
  });

  it("an object that fails its schema (a grammar kind, a bad field) is dropped with its objectsJson path; the rest are kept", () => {
    const matrix = { kind: "matrix", id: "m", x: 0, y: 0, rows: [["1"]] };
    const noValues = { ...HEATMAP, id: "h2", values: undefined };
    const { value, errors: errs } = wireToStep(
      withJson(JSON.stringify([matrix, PLOT, noValues])),
    );
    expect(value.objects.map((o) => o.id)).toEqual(["p", "a"]);
    expect(errs).toEqual([
      expect.stringMatching(/^objectsJson\.0\.kind: /),
      expect.stringMatching(/^objectsJson\.2\.values: /),
    ]);
  });

  it("actions on objectsJson's objects validate as on any object: a heatmap row shown, a plot series drawn on", () => {
    const wire = {
      ...withJson(
        JSON.stringify([HEATMAP, PLOT]),
        { do: "show", target: { id: "w", row: 0 }, durationMs: 400, cue: "go" },
        {
          do: "show",
          target: { id: "p", row: 0 },
          durationMs: 1500,
          cue: "go",
        },
      ),
    };
    const result = validateWireStep(wire, LIMITS);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.objects.map((o) => o.kind)).toEqual([
        "heatmap",
        "plot",
        "matrix",
      ]);
  });

  it("the contract's errors on objectsJson's objects come back with the conversion's, for one retry", () => {
    const tiny = {
      ...HEATMAP,
      w: 120,
      h: 120,
      values: Array(12).fill(Array(12).fill(0.5)),
      rowLabels: undefined,
      colLabels: undefined,
    };
    const result = validateWireStep(
      withJson(
        JSON.stringify([tiny, { kind: "pie" }]),
        {
          do: "show",
          target: { id: "w", row: 12 },
          durationMs: 400,
          cue: "go",
        },
        { do: "move", target: { id: "a" }, durationMs: 400, cue: "go" },
      ),
      LIMITS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toEqual([
        expect.stringMatching(/^objectsJson\.1\.kind: /),
        wireErrors.moveNeedsTo("a"),
        errors.tooSmall("w"),
        errors.targetOutOfRange("w"),
      ]);
  });
});

describe("wireToStep / wireToSketch: one test per row", () => {
  it('move needs to: a move without to is dropped and rejected with move needs to "x"', () => {
    const { value, errors: errs } = wireToStep(
      wireStepWith({
        do: "move",
        target: { id: "a" },
        durationMs: 400,
        cue: "go",
      }),
    );
    expect(errs).toEqual(['move needs to "a"']);
    expect(value.actions).toEqual([]);
  });

  it('write needs value: a write without value is dropped and rejected with write needs value "x"', () => {
    const { value, errors: errs } = wireToStep(
      wireStepWith({
        do: "write",
        target: { id: "a", row: 0, col: 0 },
        durationMs: 400,
        cue: "go",
      }),
    );
    expect(errs).toEqual(['write needs value "a"']);
    expect(value.actions).toEqual([]);
  });

  it("every conversion error is collected, not just the first, each once", () => {
    const { errors: errs } = wireToStep(
      wireStepWith(
        { do: "move", target: { id: "a" }, durationMs: 400, cue: "go" },
        { do: "write", target: { id: "b" }, durationMs: 400, cue: "go" },
        { do: "move", target: { id: "a", row: 0 }, durationMs: 400, cue: "go" },
      ),
    );
    expect(errs).toEqual(['move needs to "a"', 'write needs value "b"']);
  });

  it("a field the action's kind doesn't take (to on a show, value on a move, color on a write) is dropped, not rejected", () => {
    const { value, errors: errs } = wireToStep(
      wireStepWith(
        {
          do: "show",
          target: { id: "a" },
          durationMs: 400,
          to: { x: 1, y: 1 },
          value: "x",
          color: "warn",
          cue: "go",
        },
        {
          do: "move",
          target: { id: "a" },
          to: { x: 1, y: 1 },
          value: "x",
          durationMs: 400,
          cue: "go",
        },
        {
          do: "write",
          target: { id: "a", row: 0, col: 0 },
          value: "9",
          color: "accent",
          durationMs: 400,
          cue: "go",
        },
      ),
    );
    expect(errs).toEqual([]);
    expect(value.actions).toStrictEqual([
      { do: "show", target: { id: "a" }, durationMs: 400, cue: "go" },
      {
        do: "move",
        target: { id: "a" },
        to: { x: 1, y: 1 },
        durationMs: 400,
        cue: "go",
      },
      {
        do: "write",
        target: { id: "a", row: 0, col: 0 },
        value: "9",
        durationMs: 400,
        cue: "go",
      },
    ]);
  });

  it("a sketch keeps its narration and each action's cue (#105), and its moves and writes are checked the same way", () => {
    const { value, errors: errs } = wireToSketch({
      narration: "[[c]]Here it is.",
      objects: [],
      actions: [
        { do: "show", target: { id: "a" }, durationMs: 400, cue: "c" },
        { do: "move", target: { id: "a" }, durationMs: 400, cue: "c" },
        { do: "write", target: { id: "t" }, durationMs: 400, cue: "c" },
      ],
    });
    expect(value.narration).toBe("[[c]]Here it is.");
    expect(value.actions).toStrictEqual([
      { do: "show", target: { id: "a" }, durationMs: 400, cue: "c" },
    ]);
    expect(errs).toEqual(['move needs to "a"', 'write needs value "t"']);
  });
});

describe("validateWireStep / validateWireSketch", () => {
  it("valid wire: the converted step, valid against the contract", () => {
    const wire = wireStepWith({
      do: "highlight",
      target: { id: "a", row: 0 },
      durationMs: 400,
      cue: "go",
    });
    const result = validateWireStep(wire, LIMITS);
    expect(result).toStrictEqual({ ok: true, value: Step.parse(wire) });
  });

  it("conversion errors and the contract's errors come back together, for one retry", () => {
    const wire = wireStepWith(
      { do: "move", target: { id: "a" }, durationMs: 400, cue: "go" },
      { do: "show", target: { id: "ghost" }, durationMs: 400, cue: "nowhere" },
    );
    expect(validateWireStep(wire, LIMITS)).toStrictEqual({
      ok: false,
      errors: [
        'move needs to "a"',
        errors.unknownCue("nowhere"),
        errors.unknownObject("ghost"),
      ],
    });
  });

  it("conversion errors alone are a rejection, though what converted is valid", () => {
    const wire = wireStepWith({
      do: "write",
      target: { id: "a", row: 0, col: 0 },
      durationMs: 400,
      cue: "go",
    });
    expect(validateWireStep(wire, LIMITS)).toStrictEqual({
      ok: false,
      errors: ['write needs value "a"'],
    });
  });

  it("a field error is reported under the action's wire index, even after an action that can't convert", () => {
    const wire = wireStepWith(
      { do: "move", target: { id: "a" }, durationMs: 400, cue: "go" },
      {
        do: "show",
        target: { id: "a" },
        durationMs: MAX_DURATION_MS + 1,
        cue: "Not_a_cue",
      },
    );
    const result = validateWireStep(wire, LIMITS);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toEqual([
        expect.stringMatching(/^actions\.1\.durationMs: /),
        expect.stringMatching(/^actions\.1\.cue: /),
      ]);
  });

  it("a wire action without durationMs is a schema rejection: the contract's default doesn't apply on the wire", () => {
    const noDuration = { do: "show", target: { id: "a" }, cue: "go" };
    const result = validateWireStep(
      { ...wireStepWith(), actions: [noDuration] },
      LIMITS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toEqual([
        expect.stringMatching(/^actions\.0\.durationMs: /),
      ]);
  });

  it("output that fails the wire schema is a rejection with path: message errors", () => {
    const bad = {
      ...wireStepWith(),
      actions: [
        { do: "spin", target: { id: "a" }, durationMs: 400, cue: "go" },
      ],
    };
    const result = validateWireStep(bad, LIMITS);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toEqual([
        expect.stringMatching(/^actions\.0\.do: /),
      ]);
  });

  it("a sketch: conversion errors and validateSketch's errors together", () => {
    const result = validateWireSketch(
      {
        narration: SAID,
        objects: [{ kind: "text", id: "t", x: 10, y: 10, text: "hi" }],
        actions: [
          { do: "move", target: { id: "t" }, durationMs: 400, cue: "c" },
          { do: "show", target: { id: "ghost" }, durationMs: 400, cue: "c" },
        ],
      },
      { board: EMPTY_BOARD },
    );
    expect(result).toStrictEqual({
      ok: false,
      errors: ['move needs to "t"', errors.unknownObject("ghost")],
    });
  });

  it("a fresh sketch with a conversion error and an overlap: not drawable (no softOnly)", () => {
    const result = validateWireSketch(
      {
        narration: SAID,
        objects: [
          { kind: "latex", id: "f", x: 700, y: 450, tex: "x" },
          { kind: "latex", id: "g", x: 715, y: 450, tex: "y" },
        ],
        actions: [
          { do: "move", target: { id: "f" }, durationMs: 400, cue: "c" },
        ],
      },
      { board: EMPTY_BOARD, fresh: true },
    );
    expect(result).toStrictEqual({
      ok: false,
      errors: [
        'move needs to "f"',
        errors.overlap("f", "g", ANSWER_TEMPLATE.gap),
      ],
    });
  });

  it("a valid sketch: the converted sketch", () => {
    const wire: WireSketch = {
      narration: SAID,
      objects: [{ kind: "text", id: "t", x: 10, y: 10, text: "hi" }],
      actions: [
        {
          do: "write",
          target: { id: "t" },
          value: "bye",
          durationMs: 400,
          cue: "c",
        },
      ],
    };
    expect(validateWireSketch(wire, { board: EMPTY_BOARD })).toStrictEqual({
      ok: true,
      value: Sketch.parse(wire),
    });
  });
});

// ------------------------------------------------------------ size guard

/**
 * The API compiles each schema into a grammar and rejects one that is too large (#27). Its
 * limit isn't documented, so these are the measured sizes of the schemas a real request
 * accepted, with a little room: 3864 bytes for the step with paperRefs (#98, 2026-11-15),
 * and 3341 bytes for the step with objectsJson and paperRefs (#103, 2026-11-15). Size isn't
 * the whole story: one more object kind on top of the 2026-11-14 schemas (about 280 bytes, a member of the
 * object union) was rejected (S3), while paperRefs (about 420 bytes, no union) was accepted,
 * and the grammar takes only about 6 more string fields (ARCHITECTURE.md section 4). Probe a
 * bigger schema with a real request before raising the budget.
 */
const SCHEMA_BUDGET_BYTES = 4000;
/** The documented cap on optional properties across a request's strict schemas. */
const MAX_OPTIONAL_PROPERTIES = 24;

const bytes = (schema: unknown) => JSON.stringify(schema).length;

/** Optional properties counted once per use: a $defs entry counts at every $ref to it. */
function optionalPerUse(schema: Record<string, unknown>): number {
  const defs = (schema.$defs ?? {}) as Record<string, unknown>;
  const walk = (node: unknown): number => {
    if (!node || typeof node !== "object") return 0;
    const n = node as Record<string, unknown>;
    if (typeof n.$ref === "string")
      return walk(defs[n.$ref.replace("#/$defs/", "")]);
    let count = 0;
    if (n.properties && typeof n.properties === "object") {
      const required = new Set((n.required as string[] | undefined) ?? []);
      count += Object.keys(n.properties).filter((k) => !required.has(k)).length;
    }
    for (const [k, v] of Object.entries(n))
      if (k !== "$defs")
        count += Array.isArray(v)
          ? v.reduce((s: number, x) => s + walk(x), 0)
          : walk(v);
    return count;
  };
  return walk(schema);
}

describe("output format size guard (#27)", () => {
  it("the step and sketch output formats are the SDK's schemas for the wire format", () => {
    expect(STEP_OUTPUT_FORMAT).toEqual({
      type: "json_schema",
      schema: zodOutputFormat(WireStep).schema,
    });
    expect(SKETCH_OUTPUT_FORMAT).toEqual({
      type: "json_schema",
      schema: zodOutputFormat(WireSketch).schema,
    });
  });

  it("the wire step and sketch schemas stay under the size budget", () => {
    expect(bytes(STEP_OUTPUT_FORMAT.schema)).toBeLessThanOrEqual(
      SCHEMA_BUDGET_BYTES,
    );
    expect(bytes(SKETCH_OUTPUT_FORMAT.schema)).toBeLessThanOrEqual(
      SCHEMA_BUDGET_BYTES,
    );
  });

  it("the contract's own schemas, which the API rejects, are over the budget", () => {
    expect(bytes(zodOutputFormat(Step).schema)).toBeGreaterThan(
      SCHEMA_BUDGET_BYTES,
    );
    expect(bytes(zodOutputFormat(Sketch).schema)).toBeGreaterThan(
      SCHEMA_BUDGET_BYTES,
    );
  });

  // Structured output writes properties in the schema's order (s3-mix, #90: a write's value
  // listed before the sketch's required atMs was skipped twice). Every required action field
  // comes first, so Claude can always still add an optional one.
  it("every wire action lists its required fields before its optional ones", () => {
    for (const format of [STEP_OUTPUT_FORMAT, SKETCH_OUTPUT_FORMAT]) {
      const actions = (format.schema.properties as Record<string, unknown>)
        .actions as { items: { properties: object; required: string[] } };
      const keys = Object.keys(actions.items.properties);
      const required = new Set(actions.items.required);
      const firstOptional = keys.findIndex((k) => !required.has(k));
      expect(firstOptional).toBeGreaterThan(0);
      expect(keys.slice(firstOptional).every((k) => !required.has(k))).toBe(
        true,
      );
      expect(keys.slice(firstOptional)).toEqual(["color", "to", "value"]);
    }
  });

  // The actions name objectsJson's objects, so it is written before them: required, and listed
  // after objects and before actions (required properties are written in schema order).
  it("the wire step requires objectsJson, between objects and actions", () => {
    const schema = STEP_OUTPUT_FORMAT.schema as {
      properties: object;
      required: string[];
    };
    const keys = Object.keys(schema.properties);
    expect(schema.required).toContain("objectsJson");
    expect(keys.indexOf("objectsJson")).toBe(keys.indexOf("objects") + 1);
    expect(keys.indexOf("actions")).toBe(keys.indexOf("objectsJson") + 1);
  });

  // A widget comes at the end of a step, so widgetJson is optional (written after the actions).
  it("the wire step's widgetJson is an optional string after the actions", () => {
    const schema = STEP_OUTPUT_FORMAT.schema as {
      properties: Record<string, { type?: string }>;
      required: string[];
    };
    const keys = Object.keys(schema.properties);
    expect(schema.required).not.toContain("widgetJson");
    expect(schema.properties.widgetJson.type).toBe("string");
    expect(keys.indexOf("widgetJson")).toBeGreaterThan(keys.indexOf("actions"));
  });

  it("the wire schemas stay under the documented optional-property cap", () => {
    for (const format of [STEP_OUTPUT_FORMAT, SKETCH_OUTPUT_FORMAT])
      expect(optionalPerUse(format.schema)).toBeLessThanOrEqual(
        MAX_OPTIONAL_PROPERTIES,
      );
  });
});

// ------------------------------------------------------------ recorded response

describe("the recorded step response (lib/fakes)", () => {
  // Recorded with objectsJson, widgetJson and paperRefs on the wire and the paper's page text
  // in the request (#110): a heatmap, a heatmap widget and one quote from page 4 of the
  // Attention paper, all written by the model.
  it("is a real Sonnet 5.5 wire step that converts and passes validateStep", async () => {
    const message = await readFixture<Anthropic.Message>(config.step.fixture);
    expect(message.stop_reason).toBe("end_turn");
    const text = message.content.find((b) => b.type === "text");
    expect(validateWireStep(JSON.parse(text!.text), LIMITS).ok).toBe(true);
  });
});
