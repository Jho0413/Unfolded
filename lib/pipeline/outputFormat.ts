// The wire format: what Claude fills in with structured output for a step or a sketch
// (ARCHITECTURE.md sections 4 and 5.1). The API rejects the contract's own schema with "The
// compiled grammar is too large": the 5-kind object union times the 6-kind action union (S3,
// #27). So actions go on the wire as one flat object, `do` an enum and `color`, `to` and
// `value` optional, and are converted to the shared Step or Sketch here. shared/ and the
// player never see the wire format, and every response is still checked against the real
// contract by validateStep / validateSketch.
//
// The grammar has almost no headroom: a step's grammar holds only the board objects (matrix,
// text, latex, arrow), and the kinds it has no room for (heatmap and plot, #103, and the
// unused image) come as a JSON array in one string, `objectsJson`, parsed and checked here.
// Even one compact heatmap kind in the grammar was rejected (#103). A sketch keeps the board
// objects, image included, in its grammar. Probe a bigger schema with a real request before
// it merges; the size budget in tests/unit/lib/pipeline/outputFormat.test.ts moves with it.
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { LessonPlanOutput } from "@/shared/lesson";
import { repairSketchPlainMaths } from "@/shared/plainMaths";
import {
  type Action,
  Anchor,
  ArrowObject,
  BoardObject,
  type CuedAction,
  CuedPaperRef,
  HeatmapObject,
  HighlightColor,
  ImageObject,
  LatexObject,
  MatrixObject,
  MAX_DURATION_MS,
  OBJECT_ID_RE,
  PlotObject,
  type SceneObject,
  type Sketch,
  type Step,
  Target,
  TextObject,
} from "@/shared/scene";
import {
  type SketchContext,
  type StepLimits,
  validateSketch,
  validateStep,
  type ValidationResult,
} from "@/shared/validate";

/**
 * Every action kind's fields in one object: these every kind has, then `wireOptional`. Each
 * field has the contract's own constraints, so an error in it is reported here, under the
 * action's index on the wire: once an action that can't convert is dropped, the contract
 * would number the later ones differently.
 */
const wireRequired = {
  do: z.enum([
    "show",
    "hide",
    "highlight",
    "unhighlight",
    "move",
    "write",
  ] satisfies Action["do"][]),
  target: Target,
  durationMs: z.number().int().min(0).max(MAX_DURATION_MS),
};

/**
 * The fields only some kinds take. Structured output writes an object's properties in the
 * schema's order and skips an optional one only by moving past it, so these come after every
 * required field: once Claude wrote a required field listed after them (a sketch's old atMs),
 * it could no longer add a write's value, and the sketch failed twice with `write needs value`
 * (#90).
 */
const wireOptional = {
  /** highlight and unhighlight only. */
  color: HighlightColor.optional(),
  /** move only, and required there. */
  to: Anchor.optional(),
  /** write only, and required there. */
  value: z.string().optional(),
};

/**
 * A paper passage on the wire: the contract's CuedPaperRef without its bounds, which
 * structured output doesn't enforce. A ref that breaks them (an empty or over-long quote, page
 * 0) is dropped in wireToStep with a warning instead of failing the step: a step is still
 * worth showing without a quote (#98).
 */
const WirePaperRef = z.object({
  page: z.number().int(),
  quote: z.string(),
  label: z.string().optional(),
  cue: z.string().optional(),
});

/** A cued action on the wire, a step's or a narrated sketch's (#105). */
const WireCuedAction = z.object({
  ...wireRequired,
  cue: z.string().regex(OBJECT_ID_RE),
  ...wireOptional,
});

/** The objects a step's grammar carries, with the contract's own schemas. */
export const WireStepObject = z.union([
  MatrixObject,
  TextObject,
  LatexObject,
  ArrowObject,
]);
export type WireStepObject = z.infer<typeof WireStepObject>;

/**
 * The objects that come as JSON text in `objectsJson`, checked with the contract's own schemas.
 * Never sent as a JSON schema, so a discriminated union: an error names the object's own field.
 */
export const JsonStepObject = z.discriminatedUnion("kind", [
  HeatmapObject,
  PlotObject,
  ImageObject,
]);
export type JsonStepObject = z.infer<typeof JsonStepObject>;

export const WireStep = z.object({
  title: z.string(),
  narration: z.string(),
  objects: z.array(WireStepObject),
  /**
   * The heatmap, plot and image objects, as a JSON array in a string ("[]" for none).
   * Required, so it is written before the actions that name its objects.
   */
  objectsJson: z.string(),
  actions: z.array(WireCuedAction),
  /** Last, after everything the board needs (#98). An empty list isn't saved. */
  paperRefs: z.array(WirePaperRef).optional(),
});
export type WireStep = z.infer<typeof WireStep>;

export const WireSketch = z.object({
  narration: z.string(),
  objects: z.array(BoardObject),
  actions: z.array(WireCuedAction),
});
export type WireSketch = z.infer<typeof WireSketch>;

/** Only the SDK helper's schema is used, not its parser: the response is parsed below. */
export const STEP_OUTPUT_FORMAT: Anthropic.JSONOutputFormat = {
  type: "json_schema",
  schema: zodOutputFormat(WireStep).schema,
};
export const SKETCH_OUTPUT_FORMAT: Anthropic.JSONOutputFormat = {
  type: "json_schema",
  schema: zodOutputFormat(WireSketch).schema,
};

/** Rejections only the wire format can have, in validate.ts's style (with the target's id). */
export const wireErrors = {
  moveNeedsTo: (id: string) => `move needs to "${id}"`,
  writeNeedsValue: (id: string) => `write needs value "${id}"`,
  /** Not a rejection: the ref is dropped and this is logged (#98). */
  badPaperRef: (i: number, problems: readonly string[]) =>
    `paperRefs.${i} dropped: ${problems.join("; ")}`,
  objectsJsonNotJson: (reason: string) =>
    `objectsJson: not valid JSON (${reason})`,
  objectsJsonNotArray:
    "objectsJson: must be a JSON array of heatmap, plot and image objects",
} as const;

/** A converted step or sketch, without the actions that couldn't convert, and why. */
export interface Converted<T> {
  value: T;
  errors: string[];
  /** What was dropped without rejecting the value (a malformed paper ref), for the log. */
  warnings?: string[];
}

type WireAction = z.infer<typeof WireCuedAction>;

/**
 * One wire action as a contract action, or its error. A field the action's kind doesn't take
 * (`to` on a show) is dropped, as zod drops unknown keys from the contract's own actions.
 */
function toAction(wire: WireAction): Action | string {
  const { target, durationMs } = wire;
  switch (wire.do) {
    case "show":
    case "hide":
      return { do: wire.do, target, durationMs };
    case "highlight":
    case "unhighlight":
      return wire.color === undefined
        ? { do: wire.do, target, durationMs }
        : { do: wire.do, target, color: wire.color, durationMs };
    case "move":
      return wire.to === undefined
        ? wireErrors.moveNeedsTo(target.id)
        : { do: "move", target, to: wire.to, durationMs };
    case "write":
      return wire.value === undefined
        ? wireErrors.writeNeedsValue(target.id)
        : { do: "write", target, value: wire.value, durationMs };
  }
}

/** Converts every action, collecting every error rather than stopping at the first. */
function toActions<W extends WireAction, A>(
  wire: readonly W[],
  extra: (w: W) => A,
): Converted<(Action & A)[]> {
  const value: (Action & A)[] = [];
  const errors: string[] = [];
  for (const w of wire) {
    const action = toAction(w);
    if (typeof action === "string") errors.push(action);
    else value.push({ ...action, ...extra(w) });
  }
  return { value, errors: [...new Set(errors)] };
}

/**
 * `objectsJson` as objects, without those that fail their schema, and why. Blank is none, like
 * "[]". Errors carry the wire's own path (`objectsJson.0.values: ...`), as the wire schema's do.
 */
function parseObjectsJson(text: string): Converted<JsonStepObject[]> {
  if (text.trim() === "") return { value: [], errors: [] };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return {
      value: [],
      errors: [wireErrors.objectsJsonNotJson((err as Error).message)],
    };
  }
  if (!Array.isArray(json))
    return { value: [], errors: [wireErrors.objectsJsonNotArray] };
  const value: JsonStepObject[] = [];
  const errors: string[] = [];
  json.forEach((item: unknown, i) => {
    const parsed = JsonStepObject.safeParse(item);
    if (parsed.success) value.push(parsed.data);
    else errors.push(...schemaErrors(parsed.error, ["objectsJson", `${i}`]));
  });
  return { value, errors };
}

/**
 * The wire step as a shared Step (pure). The inverse of reading a Step as a WireStep, with the
 * heatmap, plot and image objects first: the board draws in order, so arrows and labels in
 * `objects` go on top of them.
 */
export function wireToStep(wire: WireStep): Converted<Step> {
  const json = parseObjectsJson(wire.objectsJson);
  const actions = toActions(wire.actions, (w) => ({ cue: w.cue }));
  const paperRefs: CuedPaperRef[] = [];
  const warnings: string[] = [];
  (wire.paperRefs ?? []).forEach((ref, i) => {
    const parsed = CuedPaperRef.safeParse(ref);
    if (parsed.success) paperRefs.push(parsed.data);
    else warnings.push(wireErrors.badPaperRef(i, schemaErrors(parsed.error)));
  });
  return {
    value: {
      title: wire.title,
      narration: wire.narration,
      objects: [...json.value, ...wire.objects] satisfies SceneObject[],
      actions: actions.value satisfies CuedAction[],
      // An empty list isn't saved: a step with no passages has no paperRefs.
      ...(paperRefs.length > 0 && { paperRefs }),
    },
    errors: [...json.errors, ...actions.errors],
    ...(warnings.length > 0 && { warnings }),
  };
}

/** The wire sketch as a shared Sketch (pure). The inverse of reading a Sketch as a WireSketch. */
export function wireToSketch(wire: WireSketch): Converted<Sketch> {
  const actions = toActions(wire.actions, (w) => ({ cue: w.cue }));
  return {
    value: {
      narration: wire.narration,
      objects: wire.objects,
      actions: actions.value satisfies CuedAction[],
    },
    errors: actions.errors,
  };
}

/**
 * The same "path: message" form as validate.ts's schema errors, the path under `at` when the
 * value checked sits inside the wire (objectsJson).
 */
export function schemaErrors(
  error: z.ZodError,
  at: readonly string[] = [],
): string[] {
  return error.issues.map((issue) => {
    const path = [...at, ...issue.path.map(String)].join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/**
 * Wire schema, conversion, then the contract's own validation, with the conversion's errors
 * and the contract's in one list, so the one retry fixes all of them.
 */
function check<W, T>(
  schema: z.ZodType<W>,
  input: unknown,
  convert: (wire: W) => Converted<T>,
  validate: (value: T) => ValidationResult<T>,
): ValidationResult<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: schemaErrors(parsed.error) };
  const converted = convert(parsed.data);
  const result = validate(converted.value);
  if (converted.errors.length === 0)
    return result.ok && converted.warnings !== undefined
      ? {
          ...result,
          warnings: [...converted.warnings, ...(result.warnings ?? [])],
        }
      : result;
  return {
    ok: false,
    errors: [
      ...new Set([...converted.errors, ...(result.ok ? [] : result.errors)]),
    ],
  };
}

/** A step response (parsed JSON) in the wire format, checked against the contract. */
export function validateWireStep(
  input: unknown,
  limits: StepLimits,
): ValidationResult<Step> {
  return check(WireStep, input, wireToStep, (step) =>
    validateStep(step, limits),
  );
}

/**
 * A sketch response (parsed JSON) in the wire format, checked against the contract. Maths
 * written into plain text ("d_k") is repaired first rather than rejected (shared/plainMaths.ts).
 */
export function validateWireSketch(
  input: unknown,
  ctx: SketchContext,
): ValidationResult<Sketch> {
  return check(WireSketch, input, wireToSketch, (sketch) =>
    validateSketch(repairSketchPlainMaths(sketch), ctx),
  );
}

/**
 * Not a wire format: a plan has no action unions, so Claude fills in shared/lesson.ts's own
 * LessonPlanOutput schema (ARCHITECTURE.md section 5.1).
 */
export const PLAN_OUTPUT_FORMAT: Anthropic.JSONOutputFormat = {
  type: "json_schema",
  schema: zodOutputFormat(LessonPlanOutput).schema,
};
