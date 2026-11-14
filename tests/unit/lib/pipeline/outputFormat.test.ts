// lib/pipeline/outputFormat.ts: the wire format Claude fills in (#57, ARCHITECTURE.md
// sections 4 and 5.1). One test per conversion row, named after it, plus round trips: every
// valid shared Step or Sketch read as wire comes back identical, so the two can't drift.
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { config } from "@/lib/config";
import { readFixture } from "@/lib/fakes";
import {
  SKETCH_OUTPUT_FORMAT,
  STEP_OUTPUT_FORMAT,
  validateWireSketch,
  validateWireStep,
  WireSketch,
  WireStep,
  wireErrors,
  wireToSketch,
  wireToStep,
} from "@/lib/pipeline/outputFormat";
import { type BoardState, MAX_DURATION_MS, Sketch, Step } from "@/shared/scene";
import { errors } from "@/shared/validate";

const LIMITS = { maxNarrationChars: config.maxNarrationChars };

/** A contract step read as wire: a compile error here means the contract outgrew the wire. */
const stepToWire = (step: Step): WireStep => step;
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

const boardObject = fc.oneof(
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
  fc.record(
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
  ),
);

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

/** Schema-valid contract steps, as Step.parse returns them (defaults filled in). */
const step = fc
  .record({
    title: fc.string({ minLength: 1 }),
    narration: fc.string({ minLength: 1 }),
    objects: fc.array(boardObject, { maxLength: 5 }),
    actions: fc.array(
      action.chain((a) => cue.map((c) => ({ ...a, cue: c }))),
      { maxLength: 8 },
    ),
  })
  .map((s) => Step.parse(s));

const sketch = fc
  .record({
    objects: fc.array(boardObject, { maxLength: 5 }),
    actions: fc.array(
      action.chain((a) => fc.nat().map((atMs) => ({ ...a, atMs }))),
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
        expect(wireToStep(stepToWire(s))).toStrictEqual({
          value: s,
          errors: [],
        });
      }),
    );
  });

  it("every schema-valid Sketch comes back identical, with no errors (property)", () => {
    fc.assert(
      fc.property(sketch, (s) => {
        expect(wireToSketch(sketchToWire(s))).toStrictEqual({
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

// ------------------------------------------------------------ conversion rows

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

  it("a sketch keeps each action's atMs, and its moves and writes are checked the same way", () => {
    const { value, errors: errs } = wireToSketch({
      objects: [],
      actions: [
        { do: "show", target: { id: "a" }, durationMs: 400, atMs: 250 },
        { do: "move", target: { id: "a" }, durationMs: 400, atMs: 500 },
        { do: "write", target: { id: "t" }, durationMs: 400, atMs: 900 },
      ],
    });
    expect(value.actions).toStrictEqual([
      { do: "show", target: { id: "a" }, durationMs: 400, atMs: 250 },
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

  it("the contract's rules still apply after conversion (a range the wire doesn't check)", () => {
    const wire = wireStepWith({
      do: "show",
      target: { id: "a" },
      durationMs: MAX_DURATION_MS + 1,
      cue: "go",
    });
    const result = validateWireStep(wire, LIMITS);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors[0]).toMatch(/^actions\.0\.durationMs:/);
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
        objects: [{ kind: "text", id: "t", x: 10, y: 10, text: "hi" }],
        actions: [
          { do: "move", target: { id: "t" }, durationMs: 400, atMs: 0 },
          { do: "show", target: { id: "ghost" }, durationMs: 400, atMs: 0 },
        ],
      },
      { board: EMPTY_BOARD },
    );
    expect(result).toStrictEqual({
      ok: false,
      errors: ['move needs to "t"', errors.unknownObject("ghost")],
    });
  });

  it("a valid sketch: the converted sketch", () => {
    const wire: WireSketch = {
      objects: [{ kind: "text", id: "t", x: 10, y: 10, text: "hi" }],
      actions: [
        {
          do: "write",
          target: { id: "t" },
          value: "bye",
          durationMs: 400,
          atMs: 100,
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
 * accepted (2026-11-14), with a little room. One more object kind on top of them was
 * rejected (S3), and is about 280 bytes, so it fails here first: probe a bigger schema with a
 * real request before raising the budget.
 */
const SCHEMA_BUDGET_BYTES = 3600;
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

  it("the wire schemas stay under the documented optional-property cap", () => {
    for (const format of [STEP_OUTPUT_FORMAT, SKETCH_OUTPUT_FORMAT])
      expect(optionalPerUse(format.schema)).toBeLessThanOrEqual(
        MAX_OPTIONAL_PROPERTIES,
      );
  });
});

// ------------------------------------------------------------ recorded response

describe("the recorded step response (lib/fakes)", () => {
  it("is a real Sonnet 5.5 wire step that converts and passes validateStep", async () => {
    const message = await readFixture<Anthropic.Message>(config.step.fixture);
    expect(message.stop_reason).toBe("end_turn");
    const text = message.content.find((b) => b.type === "text");
    expect(validateWireStep(JSON.parse(text!.text), LIMITS).ok).toBe(true);
  });
});
