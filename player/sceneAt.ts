// The board at time t (ARCHITECTURE.md section 5.3). Pure: the same inputs
// always give the same output, and nothing is mutated, so a seek (Back,
// Replay, scrubbing) is just a call with another time.
import {
  type Action,
  type Anchor,
  type BoardObject,
  type BoardState,
  CELL,
  cellCentre,
  type CuedAction,
  type HighlightColor,
  isPoint,
  type MatrixObject,
  type ObjectState,
  type PartCopy,
  type Point,
  type Target,
} from "@/shared/scene";
import type { CueTimes } from "@/shared/lesson";

/** One action on the timeline. `durationMs` here wins over `action.durationMs`. */
export interface TimedAction {
  action: Action;
  startMs: number;
  durationMs: number;
}

/**
 * Lesson-mode timeline: each cued action starts at its cue's time. Actions
 * whose cue has no time are left out (validation rejects them upstream).
 */
export function timeline(
  actions: readonly CuedAction[],
  cueTimes: CueTimes,
): TimedAction[] {
  const out: TimedAction[] = [];
  for (const action of actions) {
    const startMs = cueTimes[action.cue];
    if (startMs === undefined) continue;
    out.push({ action, startMs, durationMs: action.durationMs });
  }
  return out;
}

// ---------------------------------------------------------------- state

/** The mutable board while actions are applied. Turned into a BoardState at the end. */
interface Board {
  states: ObjectState[];
  byId: Map<string, ObjectState>;
  copies: PartCopy[];
  /** Part key ("a:r0", "a:c1", "a:r0c1") -> its copy. */
  copyByKey: Map<string, PartCopy>;
}

function partKey(t: Target): string {
  return `${t.id}:${t.row !== undefined ? `r${t.row}` : ""}${
    t.col !== undefined ? `c${t.col}` : ""
  }`;
}

function isPart(t: Target): boolean {
  return t.row !== undefined || t.col !== undefined;
}

function initialBoard(objects: readonly BoardObject[]): Board {
  const states: ObjectState[] = [];
  const byId = new Map<string, ObjectState>();
  for (const source of objects) {
    if (byId.has(source.id)) continue; // first wins, as in validate.ts
    const object = structuredClone(source);
    const state: ObjectState = {
      object,
      visible: !object.hidden,
      highlight: null,
      ...(object.kind === "matrix"
        ? { cellHighlight: object.rows.map((r) => r.map(() => null)) }
        : {}),
    };
    states.push(state);
    byId.set(object.id, state);
  }
  return { states, byId, copies: [], copyByKey: new Map() };
}

function cloneBoard(board: Board): Board {
  const states = structuredClone(board.states);
  const copies = structuredClone(board.copies);
  return {
    states,
    byId: new Map(states.map((s) => [s.object.id, s])),
    copies,
    copyByKey: new Map(copies.map((c) => [partKey(c.source), c])),
  };
}

// ---------------------------------------------------------------- geometry

/** The matrix behind a part target, if the target is a valid part of one. */
function matrixPart(
  board: Board,
  t: Target,
): { state: ObjectState; matrix: MatrixObject } | undefined {
  const state = board.byId.get(t.id);
  if (state?.object.kind !== "matrix") return undefined;
  const matrix = state.object;
  if (t.row !== undefined && (t.row < 0 || t.row >= matrix.rows.length))
    return undefined;
  if (t.col !== undefined && (t.col < 0 || t.col >= matrix.rows[0].length))
    return undefined;
  return { state, matrix };
}

/** Cells (r, c) a target covers in its matrix: the whole matrix, a row, a column or one cell. */
function cellsOf(matrix: MatrixObject, t: Target): [number, number][] {
  const out: [number, number][] = [];
  matrix.rows.forEach((row, r) =>
    row.forEach((_, c) => {
      if (
        (t.row === undefined || t.row === r) &&
        (t.col === undefined || t.col === c)
      )
        out.push([r, c]);
    }),
  );
  return out;
}

function mean(points: Point[]): Point {
  const n = points.length;
  return {
    x: points.reduce((s, p) => s + p.x, 0) / n,
    y: points.reduce((s, p) => s + p.y, 0) / n,
  };
}

/** Centre of a target in the source matrix or object, ignoring copies. */
function sourceCentre(board: Board, t: Target): Point | undefined {
  const state = board.byId.get(t.id);
  if (!state) return undefined;
  const obj = state.object;
  if (isPart(t)) {
    const part = matrixPart(board, t);
    if (!part) return undefined;
    const { matrix } = part;
    return mean(
      cellsOf(matrix, t).map(([r, c]) => cellCentre(matrix.x, matrix.y, r, c)),
    );
  }
  switch (obj.kind) {
    case "matrix":
      return {
        x: obj.x + (obj.rows[0].length * CELL.w) / 2,
        y: obj.y + (obj.rows.length * CELL.h) / 2,
      };
    case "text":
    case "latex":
      return { x: obj.x, y: obj.y };
    case "image":
      return { x: obj.x + obj.w / 2, y: obj.y + obj.h / 2 };
    case "arrow": {
      // Arrow ends never name arrows (validate.ts), so this doesn't recurse further.
      const from = anchorOnBoard(board, obj.from, false);
      const to = anchorOnBoard(board, obj.to, false);
      return from && to ? mean([from, to]) : undefined;
    }
  }
}

function anchorOnBoard(
  board: Board,
  anchor: Anchor,
  arrows = true,
): Point | undefined {
  if (isPoint(anchor)) return { x: anchor.x, y: anchor.y };
  if (!arrows && board.byId.get(anchor.id)?.object.kind === "arrow")
    return undefined;
  if (isPart(anchor)) {
    const copy = board.copyByKey.get(partKey(anchor));
    if (copy) return { x: copy.x, y: copy.y };
  }
  return sourceCentre(board, anchor);
}

/**
 * Where an anchor is on a board: a point, or the centre of a target. A part
 * that has moved resolves to its copy (ARCHITECTURE.md section 4). For the
 * renderer, e.g. an arrow's ends. Undefined for an unknown target.
 */
export function resolveAnchor(
  state: BoardState,
  anchor: Anchor,
): Point | undefined {
  const byId = new Map(state.objects.map((s) => [s.object.id, s]));
  return anchorOnBoard(
    {
      states: state.objects,
      byId,
      copies: state.copies,
      copyByKey: new Map(state.copies.map((c) => [partKey(c.source), c])),
    },
    anchor,
  );
}

function moveObjectCentre(obj: BoardObject, to: Point): void {
  switch (obj.kind) {
    case "matrix":
      obj.x = to.x - (obj.rows[0].length * CELL.w) / 2;
      obj.y = to.y - (obj.rows.length * CELL.h) / 2;
      break;
    case "text":
    case "latex":
      obj.x = to.x;
      obj.y = to.y;
      break;
    case "image":
      obj.x = to.x - obj.w / 2;
      obj.y = to.y - obj.h / 2;
      break;
    case "arrow":
      break; // arrows can't move
  }
}

function lerp(a: Point, b: Point, p: number): Point {
  return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
}

// ---------------------------------------------------------------- actions

interface Entry {
  action: Action;
  startMs: number;
  durationMs: number;
}

/** Start and end of a move, fixed by the board as it was when the move started. */
interface MovePlan {
  from: Point;
  to: Point;
}

function progressAt(e: Entry, tMs: number): number {
  if (e.durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, (tMs - e.startMs) / e.durationMs));
}

function setHighlight(
  board: Board,
  t: Target,
  color: HighlightColor | null,
  only: HighlightColor | undefined,
): void {
  const state = board.byId.get(t.id);
  if (!state) return;
  const clears = (current: HighlightColor | null) =>
    color !== null || only === undefined || current === only;
  if (state.object.kind !== "matrix") {
    if (!isPart(t) && clears(state.highlight)) state.highlight = color;
    return;
  }
  const part = matrixPart(board, t);
  const grid = state.cellHighlight;
  if (!part || !grid) return;
  for (const [r, c] of cellsOf(part.matrix, t))
    if (clears(grid[r][c])) grid[r][c] = color;
}

function apply(
  board: Board,
  e: Entry,
  p: number,
  plan: MovePlan | undefined,
): void {
  const { action } = e;
  const t = action.target;
  const state = board.byId.get(t.id);
  if (!state) return; // unknown target: validation rejects it upstream
  switch (action.do) {
    case "show":
      // Visible from the start, so the renderer can fade it in with progress.
      if (!isPart(t)) state.visible = true;
      break;
    case "hide":
      // Visible until the end, so the renderer can fade it out with progress.
      if (p < 1) break;
      if (!isPart(t)) state.visible = false;
      else {
        const copy = board.copyByKey.get(partKey(t));
        if (copy) copy.visible = false; // a part that never moved: no change
      }
      break;
    case "highlight":
      setHighlight(board, t, action.color ?? "accent", undefined);
      break;
    case "unhighlight":
      setHighlight(board, t, null, action.color);
      break;
    case "write": {
      const obj = state.object;
      if (obj.kind === "text" && !isPart(t)) obj.text = action.value;
      else if (
        obj.kind === "matrix" &&
        t.row !== undefined &&
        t.col !== undefined &&
        matrixPart(board, t)
      )
        obj.rows[t.row][t.col] = action.value;
      break;
    }
    case "move": {
      if (!plan) break;
      const at = lerp(plan.from, plan.to, p);
      if (!isPart(t)) {
        moveObjectCentre(state.object, at);
        break;
      }
      const key = partKey(t);
      let copy = board.copyByKey.get(key);
      if (!copy) {
        copy = {
          source: {
            id: t.id,
            ...(t.row !== undefined ? { row: t.row } : {}),
            ...(t.col !== undefined ? { col: t.col } : {}),
          },
          x: at.x,
          y: at.y,
          visible: true,
        };
        board.copies.push(copy);
        board.copyByKey.set(key, copy);
      }
      copy.x = at.x;
      copy.y = at.y;
      break;
    }
  }
}

/** The move's start and end on `board`, or undefined if it can't move. */
function planMove(board: Board, action: Action): MovePlan | undefined {
  if (action.do !== "move") return undefined;
  const t = action.target;
  const kind = board.byId.get(t.id)?.object.kind;
  if (kind === undefined || kind === "arrow") return undefined;
  if (isPart(t) && !matrixPart(board, t)) return undefined;
  const from = anchorOnBoard(board, t);
  const to = anchorOnBoard(board, action.to);
  return from && to ? { from, to } : undefined;
}

/** Applies `entries` (all started by `tMs`) to a copy of `base`, in order. */
function run(
  base: Board,
  entries: readonly Entry[],
  plans: readonly (MovePlan | undefined)[],
  tMs: number,
): Board {
  const board = cloneBoard(base);
  entries.forEach((e, i) => apply(board, e, progressAt(e, tMs), plans[i]));
  return board;
}

/**
 * The board at `tMs`: `objects` as the step starts, with every action of
 * `timed` that has started by then applied. Actions apply in start order;
 * actions that start at the same time apply in their array order.
 *
 * - `show`, `highlight`, `unhighlight` and `write` take effect when they
 *   start; `hide` when it ends. `move` slides linearly from where its target
 *   was when the move started to where its anchor was then.
 * - `active` lists the actions in progress (start <= t < start + duration),
 *   with how far along they are, 0..1.
 * - Actions on unknown or invalid targets are ignored (validate.ts rejects
 *   them before they reach the player).
 */
export function sceneAt(
  objects: readonly BoardObject[],
  timed: readonly TimedAction[],
  tMs: number,
): BoardState {
  const started: Entry[] = timed
    .map((t) => ({
      action: t.action,
      startMs: t.startMs,
      durationMs: t.durationMs,
    }))
    .filter((e) => e.startMs <= tMs)
    .sort((a, b) => a.startMs - b.startMs); // stable: ties keep array order

  const base = initialBoard(objects);
  // A move's path depends only on the board when it started, so each plan is
  // computed once from the actions before it, at its start time.
  const plans: (MovePlan | undefined)[] = [];
  started.forEach((e, i) => {
    plans.push(
      e.action.do === "move"
        ? planMove(run(base, started.slice(0, i), plans, e.startMs), e.action)
        : undefined,
    );
  });

  const board = run(base, started, plans, tMs);
  return {
    objects: board.states,
    copies: board.copies,
    active: started
      .filter((e) => e.durationMs > 0 && tMs < e.startMs + e.durationMs)
      .map((e) => ({ action: e.action, progress: progressAt(e, tMs) })),
  };
}
