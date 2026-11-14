// The wire format: what Claude fills in with structured output for a step or a sketch
// (ARCHITECTURE.md sections 4 and 5.1). The API rejects the contract's own schema with "The
// compiled grammar is too large": the 5-kind object union times the 6-kind action union (S3,
// #27). So actions go on the wire as one flat object, `do` an enum and `color`, `to` and
// `value` optional, and are converted to the shared Step or Sketch here. Objects keep the
// contract's own schema. shared/ and the player never see the wire format, and every response
// is still checked against the real contract by validateStep / validateSketch.
//
// Neither schema has headroom: S3 found one more object kind on top of this is rejected too.
// A new primitive needs a real request first, then the size budget in
// tests/unit/lib/pipeline/outputFormat.test.ts moves with it.
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { LessonPlanOutput } from "@/shared/lesson";
import {
  type Action,
  Anchor,
  BoardObject,
  type CuedAction,
  HighlightColor,
  MAX_DURATION_MS,
  OBJECT_ID_RE,
  type Sketch,
  type Step,
  Target,
  type TimedSketchAction,
} from "@/shared/scene";
import {
  type SketchContext,
  type StepLimits,
  validateSketch,
  validateStep,
  type ValidationResult,
} from "@/shared/validate";

/**
 * Every action kind's fields in one object. Each field has the contract's own constraints, so
 * an error in it is reported here, under the action's index on the wire: once an action that
 * can't convert is dropped, the contract would number the later ones differently.
 */
const wireAction = {
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
  /** highlight and unhighlight only. */
  color: HighlightColor.optional(),
  /** move only, and required there. */
  to: Anchor.optional(),
  /** write only, and required there. */
  value: z.string().optional(),
};

export const WireStep = z.object({
  title: z.string(),
  narration: z.string(),
  objects: z.array(BoardObject),
  actions: z.array(
    z.object({ ...wireAction, cue: z.string().regex(OBJECT_ID_RE) }),
  ),
});
export type WireStep = z.infer<typeof WireStep>;

export const WireSketch = z.object({
  objects: z.array(BoardObject),
  actions: z.array(z.object({ ...wireAction, atMs: z.number().int().min(0) })),
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
} as const;

/** A converted step or sketch, without the actions that couldn't convert, and why. */
export interface Converted<T> {
  value: T;
  errors: string[];
}

type WireAction = WireStep["actions"][number] | WireSketch["actions"][number];

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

/** The wire step as a shared Step (pure). The inverse of reading a Step as a WireStep. */
export function wireToStep(wire: WireStep): Converted<Step> {
  const actions = toActions(wire.actions, (w) => ({ cue: w.cue }));
  return {
    value: {
      title: wire.title,
      narration: wire.narration,
      objects: wire.objects,
      actions: actions.value satisfies CuedAction[],
    },
    errors: actions.errors,
  };
}

/** The wire sketch as a shared Sketch (pure). The inverse of reading a Sketch as a WireSketch. */
export function wireToSketch(wire: WireSketch): Converted<Sketch> {
  const actions = toActions(wire.actions, (w) => ({ atMs: w.atMs }));
  return {
    value: {
      objects: wire.objects,
      actions: actions.value satisfies TimedSketchAction[],
    },
    errors: actions.errors,
  };
}

/** The same "path: message" form as validate.ts's schema errors. */
export function schemaErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
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
  if (converted.errors.length === 0) return result;
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

/** A sketch response (parsed JSON) in the wire format, checked against the contract. */
export function validateWireSketch(
  input: unknown,
  ctx: SketchContext,
): ValidationResult<Sketch> {
  return check(WireSketch, input, wireToSketch, (sketch) =>
    validateSketch(sketch, ctx),
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
