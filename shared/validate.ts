// The checks zod can't express (ARCHITECTURE.md section 4 validation table).
// Runs on the server after Claude responds and in the browser before a tool
// draws, so it must stay free of node-only imports.
import katex from "katex";
import type { z } from "zod";
import {
  type Action,
  type Anchor,
  type BoardObject,
  type BoardState,
  CANVAS,
  CELL,
  CUE_MARKER_RE,
  isPoint,
  Sketch,
  Step,
  type Target,
} from "./scene";

export type ValidationResult<T> =
  { ok: true; value: T } | { ok: false; errors: string[] };

export interface StepLimits {
  /** `config.maxNarrationChars`, passed in so this file stays out of server-only lib/. */
  maxNarrationChars: number;
}

export interface SketchContext {
  /** The board the sketch draws on. */
  board: BoardState;
  /** True: the sketch starts from an empty board, so board ids are unknown. */
  fresh?: boolean;
}

// ---------------------------------------------------------------- markers

/** Valid marker | complete but malformed `[[...]]` | stray `[[` or `]]`. Tried left to right. */
const MARKER_SCAN_RE =
  /\[\[([a-z][a-z0-9_]{0,31})\]\]|\[\[[^[\]]*\]\]|\[\[|\]\]/g;

export interface ParsedNarration {
  /** Cue names in text order, duplicates included. */
  cues: string[];
  /** Malformed markers in text order, as written. */
  malformed: string[];
  /** Markers stripped, trimmed, whitespace collapsed: the text sent to TTS. */
  spoken: string;
}

export function parseNarration(narration: string): ParsedNarration {
  const cues: string[] = [];
  const malformed: string[] = [];
  for (const m of narration.matchAll(MARKER_SCAN_RE)) {
    if (m[1] !== undefined) cues.push(m[1]);
    else malformed.push(m[0]);
  }
  const spoken = narration
    .replace(CUE_MARKER_RE, "")
    .trim()
    .replace(/\s+/g, " ");
  return { cues, malformed, spoken };
}

// ---------------------------------------------------------------- errors

export const errors = {
  unknownCue: (cue: string) => `unknown cue "${cue}"`,
  duplicateCue: (cue: string) => `duplicate cue "${cue}"`,
  malformedMarker: (m: string) => `malformed marker "${m}"`,
  unknownObject: (id: string) => `unknown object "${id}"`,
  targetOutOfRange: () => "target out of range",
  writeNeedsCell: () => "write needs a cell",
  cantWrite: (id: string) => `can't write to "${id}"`,
  showNeedsWhole: () => "show needs a whole object",
  cantMove: (id: string) => `can't move "${id}"`,
  invalidLatex: (id: string) => `invalid LaTeX in "${id}"`,
  offCanvas: () => "off canvas",
  duplicateId: (id: string) => `duplicate id "${id}"`,
  narrationTooLong: () => "narration too long",
} as const;

function schemaErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

// ---------------------------------------------------------------- geometry

function inCanvas(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x <= CANVAS.w && y <= CANVAS.h;
}

function boxInCanvas(x: number, y: number, w: number, h: number): boolean {
  return inCanvas(x, y) && inCanvas(x + w, y + h);
}

function objectOnCanvas(obj: BoardObject): boolean {
  switch (obj.kind) {
    case "matrix":
      return boxInCanvas(
        obj.x,
        obj.y,
        obj.rows[0].length * CELL.w,
        obj.rows.length * CELL.h,
      );
    case "text":
    case "latex":
      return inCanvas(obj.x, obj.y);
    case "image":
      return boxInCanvas(obj.x, obj.y, obj.w, obj.h);
    case "arrow":
      return [obj.from, obj.to].every((a) => !isPoint(a) || inCanvas(a.x, a.y));
  }
}

function latexParses(tex: string): boolean {
  try {
    katex.renderToString(tex, { throwOnError: true });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- references

type Objects = ReadonlyMap<string, BoardObject>;

/** Checks a target's id and row/col. Returns its object if the id is known. */
function checkTarget(
  target: Target,
  objects: Objects,
  out: string[],
): BoardObject | undefined {
  const obj = objects.get(target.id);
  if (!obj) {
    out.push(errors.unknownObject(target.id));
    return undefined;
  }
  if (target.row !== undefined || target.col !== undefined) {
    const inRange =
      obj.kind === "matrix" &&
      (target.row === undefined || target.row < obj.rows.length) &&
      (target.col === undefined || target.col < obj.rows[0].length);
    if (!inRange) out.push(errors.targetOutOfRange());
  }
  return obj;
}

function checkAnchor(anchor: Anchor, objects: Objects, out: string[]): void {
  if (isPoint(anchor)) {
    if (!inCanvas(anchor.x, anchor.y)) out.push(errors.offCanvas());
  } else {
    checkTarget(anchor, objects, out);
  }
}

/**
 * Checks one action against the objects it can name. Exported for the Q&A
 * tools (e.g. `highlight` on an unknown id).
 */
export function checkAction(action: Action, objects: Objects): string[] {
  const out: string[] = [];
  const obj = checkTarget(action.target, objects, out);
  const { row, col } = action.target;
  switch (action.do) {
    case "show":
      if (row !== undefined || col !== undefined)
        out.push(errors.showNeedsWhole());
      break;
    case "move":
      if (obj?.kind === "arrow") out.push(errors.cantMove(obj.id));
      checkAnchor(action.to, objects, out);
      break;
    case "write":
      if (
        obj?.kind === "latex" ||
        obj?.kind === "arrow" ||
        obj?.kind === "image"
      )
        out.push(errors.cantWrite(obj.id));
      else if (
        obj?.kind === "matrix" &&
        (row === undefined || col === undefined)
      )
        out.push(errors.writeNeedsCell());
      break;
    case "hide":
    case "highlight":
    case "unhighlight":
      // show on a visible object, hide on a hidden one, or hide on a part
      // that hasn't moved: allowed, no change.
      break;
  }
  return out;
}

/** Duplicate ids, canvas bounds, LaTeX and arrow anchors of new objects. */
function checkObjects(
  newObjects: readonly BoardObject[],
  known: Objects,
  takenIds: ReadonlySet<string>,
  out: string[],
): void {
  const seen = new Set(takenIds);
  for (const obj of newObjects) {
    if (seen.has(obj.id)) out.push(errors.duplicateId(obj.id));
    seen.add(obj.id);
    if (!objectOnCanvas(obj)) out.push(errors.offCanvas());
    if (obj.kind === "latex" && !latexParses(obj.tex))
      out.push(errors.invalidLatex(obj.id));
    if (obj.kind === "arrow") {
      for (const end of [obj.from, obj.to])
        if (!isPoint(end)) checkTarget(end, known, out);
    }
  }
}

function byId(...lists: (readonly BoardObject[])[]): Map<string, BoardObject> {
  const map = new Map<string, BoardObject>();
  for (const list of lists)
    for (const obj of list) if (!map.has(obj.id)) map.set(obj.id, obj);
  return map;
}

// ---------------------------------------------------------------- step

/** The rules zod can't express, for a step that already passed the schema. */
export function checkStep(step: Step, limits: StepLimits): string[] {
  const out: string[] = [];
  const { cues, malformed, spoken } = parseNarration(step.narration);

  for (const m of malformed) out.push(errors.malformedMarker(m));
  const seenCues = new Set<string>();
  for (const cue of cues) {
    if (seenCues.has(cue)) out.push(errors.duplicateCue(cue));
    seenCues.add(cue);
  }
  if (spoken.length > limits.maxNarrationChars)
    out.push(errors.narrationTooLong());

  const objects = byId(step.objects);
  checkObjects(step.objects, objects, new Set(), out);
  for (const action of step.actions) {
    if (!seenCues.has(action.cue)) out.push(errors.unknownCue(action.cue));
    out.push(...checkAction(action, objects));
  }
  return unique(out);
}

/** Schema, then the rules zod can't express. */
export function validateStep(
  input: unknown,
  limits: StepLimits,
): ValidationResult<Step> {
  const parsed = Step.safeParse(input);
  if (!parsed.success) return { ok: false, errors: schemaErrors(parsed.error) };
  const errs = checkStep(parsed.data, limits);
  return errs.length
    ? { ok: false, errors: errs }
    : { ok: true, value: parsed.data };
}

// ---------------------------------------------------------------- sketch

/**
 * The rules zod can't express, for a sketch that already passed the schema.
 * Known ids are the sketch's own objects plus the board's (none if `fresh`).
 */
export function checkSketch(sketch: Sketch, ctx: SketchContext): string[] {
  const out: string[] = [];
  const boardObjects = ctx.fresh ? [] : ctx.board.objects.map((s) => s.object);
  const objects = byId(sketch.objects, boardObjects);
  checkObjects(
    sketch.objects,
    objects,
    new Set(boardObjects.map((o) => o.id)),
    out,
  );
  for (const action of sketch.actions)
    out.push(...checkAction(action, objects));
  return unique(out);
}

export function validateSketch(
  input: unknown,
  ctx: SketchContext,
): ValidationResult<Sketch> {
  const parsed = Sketch.safeParse(input);
  if (!parsed.success) return { ok: false, errors: schemaErrors(parsed.error) };
  const errs = checkSketch(parsed.data, ctx);
  return errs.length
    ? { ok: false, errors: errs }
    : { ok: true, value: parsed.data };
}
