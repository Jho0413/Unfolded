// The checks zod can't express (ARCHITECTURE.md section 4 validation table).
// Runs on the server after Claude responds and in the browser before a tool
// draws, so it must stay free of node-only imports.
import katex from "katex";
import type { z } from "zod";
import {
  type Box,
  boxGap,
  boxInside,
  objectBox,
  TEXT_SIZE,
  textBox,
} from "./boxes";
import { KATEX_OPTIONS } from "./latex";
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
  targetOutOfRange: (id: string) => `target out of range "${id}"`,
  writeNeedsCell: () => "write needs a cell",
  cantWrite: (id: string) => `can't write to "${id}"`,
  showNeedsWhole: () => "show needs a whole object",
  cantMove: (id: string) => `can't move "${id}"`,
  invalidLatex: (id: string) => `invalid LaTeX in "${id}"`,
  offCanvas: (id: string) => `off canvas "${id}"`,
  duplicateId: (id: string) => `duplicate id "${id}"`,
  narrationTooLong: () => "narration too long",
  narrationEmpty: () => "narration empty",
  cantAnchorToArrow: (id: string) => `can't anchor to "${id}"`,
  tooManyObjects: (n: number) =>
    `too many objects (${n}; an answer board takes at most ${ANSWER_TEMPLATE.maxContent} besides its arrows)`,
  tooManyArrows: (n: number) =>
    `too many arrows (${n}; an answer board takes at most ${ANSWER_TEMPLATE.maxArrows})`,
  outsideAnswerArea: (id: string) => `outside the answer area "${id}"`,
  tooClose: (a: string, b: string, gap: number) =>
    `"${a}" and "${b}" are too close (leave ${gap} between them)`,
  mathsInPlainText: (id: string) =>
    `"_" or "^" in plain text "${id}" (write maths as a latex object)`,
} as const;

/** One line of text, a title or a takeaway, centred at x, y in a text size. */
type TemplateLine = { x: number; y: number; size: keyof typeof TEXT_SIZE };

const TITLE: TemplateLine = { x: 800, y: 110, size: "m" };
const TAKEAWAY: TemplateLine = { x: 800, y: 810, size: "s" };
const GAP = 40;
/** Half a line of text in `size`: how far a line's box reaches above and below its y. */
const halfLine = (line: TemplateLine) =>
  textBox("", TEXT_SIZE[line.size]).h / 2;

/**
 * A fresh sketch is a drawn answer on its own clean board, the Answer view (ARCHITECTURE.md
 * sections 5.6 and 8), laid out from one template: a short title at the top centre, the
 * content in one row or column inside the content area, an optional one-line takeaway under
 * it. The content area is the space the title and takeaway leave with `gap` around them, so
 * a layout that follows the template always passes. The prompt describes it from these
 * numbers, and checkSketch holds a fresh sketch to the counts, `area` and the gaps (every
 * object's estimated box, shared/boxes.ts): `gap` between any two objects, `arrowGap` between
 * two an arrow joins, so the arrow shows. The area keeps clear of the Answer view's tag and
 * chip above it (app/lesson/[lessonId]/AnswerView.module.css).
 */
export const ANSWER_TEMPLATE = {
  /** Objects other than arrows: texts, formulas and matrices, the title and takeaway included. */
  maxContent: 8,
  maxArrows: 6,
  area: { x0: 120, y0: 60, x1: 1480, y1: 860 },
  title: TITLE,
  content: {
    x0: 200,
    y0: Math.ceil(TITLE.y + halfLine(TITLE) + GAP),
    x1: 1400,
    y1: Math.floor(TAKEAWAY.y - halfLine(TAKEAWAY) - GAP),
  },
  takeaway: TAKEAWAY,
  gap: GAP,
  arrowGap: 80,
} as const satisfies {
  maxContent: number;
  maxArrows: number;
  gap: number;
  arrowGap: number;
  area: Box;
  content: Box;
  title: TemplateLine;
  takeaway: TemplateLine;
};

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

/**
 * Whether KaTeX renders `tex` cleanly under KATEX_OPTIONS. A command refused
 * by `trust: false` (\href, \url, \htmlClass, ...) doesn't throw, it renders
 * as red source text, so the trust check is a callback that records the
 * refusal and still refuses, as `trust: false` does.
 */
function latexParses(tex: string): boolean {
  let refused = false;
  try {
    katex.renderToString(tex, {
      ...KATEX_OPTIONS,
      throwOnError: true,
      trust: () => {
        refused = true;
        return false;
      },
    });
    return !refused;
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
    if (!inRange) out.push(errors.targetOutOfRange(target.id));
  }
  return obj;
}

/** `owner`: the id an off-canvas point is reported under (the moving object). */
function checkAnchor(
  anchor: Anchor,
  owner: string,
  objects: Objects,
  out: string[],
): void {
  if (isPoint(anchor)) {
    if (!inCanvas(anchor.x, anchor.y)) out.push(errors.offCanvas(owner));
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
      checkAnchor(action.to, action.target.id, objects, out);
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
    if (!objectOnCanvas(obj)) out.push(errors.offCanvas(obj.id));
    if (obj.kind === "latex" && !latexParses(obj.tex))
      out.push(errors.invalidLatex(obj.id));
    if (obj.kind === "arrow") {
      for (const end of [obj.from, obj.to])
        if (!isPoint(end)) {
          // An arrow's centre is the midpoint of its ends, so an arrow end
          // naming an arrow (itself, or a cycle) has no position.
          const target = checkTarget(end, known, out);
          if (target?.kind === "arrow")
            out.push(errors.cantAnchorToArrow(target.id));
        }
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
  if (spoken.length === 0) out.push(errors.narrationEmpty());

  const objects = byId(step.objects);
  checkObjects(step.objects, objects, new Set(), out);
  for (const action of step.actions) {
    if (!seenCues.has(action.cue)) out.push(errors.unknownCue(action.cue));
    out.push(...checkAction(action, objects));
  }
  for (const ref of step.paperRefs ?? [])
    if (ref.cue !== undefined && !seenCues.has(ref.cue))
      out.push(errors.unknownCue(ref.cue));
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
  const out: string[] = ctx.fresh ? checkAnswerLayout(sketch) : [];
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

/** Underscores and carets are maths, which plain text shows raw ("d_k"). */
const PLAIN_MATHS_RE = /[_^]/;

/**
 * The answer template's rules for a fresh sketch: at most `maxContent` objects besides at
 * most `maxArrows` arrows, each one's
 * estimated box (and an arrow's point ends) inside `area` with room around it, and no maths
 * in plain text (text, labels, matrix cells, and the values written into them).
 */
function checkAnswerLayout(sketch: Sketch): string[] {
  const out: string[] = [];
  const { maxContent, maxArrows, area } = ANSWER_TEMPLATE;
  const arrows = sketch.objects.filter((o) => o.kind === "arrow").length;
  const content = sketch.objects.length - arrows;
  if (content > maxContent) out.push(errors.tooManyObjects(content));
  if (arrows > maxArrows) out.push(errors.tooManyArrows(arrows));
  const inArea = (p: { x: number; y: number }) =>
    boxInside({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }, area);
  out.push(...checkGaps(sketch.objects));
  for (const obj of sketch.objects) {
    const box = objectBox(obj);
    const inside =
      obj.kind === "arrow"
        ? [obj.from, obj.to].every((a) => !isPoint(a) || inArea(a))
        : box !== undefined && boxInside(box, area);
    if (!inside) out.push(errors.outsideAnswerArea(obj.id));
    if (plainTexts(obj).some((t) => PLAIN_MATHS_RE.test(t)))
      out.push(errors.mathsInPlainText(obj.id));
  }
  for (const action of sketch.actions) {
    if (action.do === "write" && PLAIN_MATHS_RE.test(action.value))
      out.push(errors.mathsInPlainText(action.target.id));
    if (action.do === "move" && isPoint(action.to) && !inArea(action.to))
      out.push(errors.outsideAnswerArea(action.target.id));
  }
  return out;
}

/**
 * Every two boxed objects at least `gap` apart, and two that an arrow joins (whole objects or
 * their parts) at least `arrowGap`, so the arrow has room to show between them.
 */
function checkGaps(objects: readonly BoardObject[]): string[] {
  const { gap, arrowGap } = ANSWER_TEMPLATE;
  const joined = new Set<string>();
  const pair = (a: string, b: string) => [a, b].sort().join(" ");
  for (const obj of objects)
    if (obj.kind === "arrow" && !isPoint(obj.from) && !isPoint(obj.to))
      joined.add(pair(obj.from.id, obj.to.id));
  const boxed = objects.flatMap((obj) => {
    const box = objectBox(obj);
    return box === undefined ? [] : [{ id: obj.id, box }];
  });
  const out: string[] = [];
  boxed.forEach((a, i) => {
    for (const b of boxed.slice(0, i)) {
      const need = joined.has(pair(a.id, b.id)) ? arrowGap : gap;
      // Estimated boxes are fractional: a gap a rounding error short still counts.
      if (boxGap(a.box, b.box) < need - 1e-6)
        out.push(errors.tooClose(b.id, a.id, need));
    }
  });
  return out;
}

/** What an object shows as plain text, not LaTeX. */
function plainTexts(obj: BoardObject): string[] {
  switch (obj.kind) {
    case "text":
      return [obj.text];
    case "matrix":
      return [...(obj.label ? [obj.label] : []), ...obj.rows.flat()];
    case "arrow":
      return obj.label ? [obj.label] : [];
    case "latex":
    case "image":
      return [];
  }
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
