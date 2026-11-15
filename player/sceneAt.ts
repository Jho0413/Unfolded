// The board at time t (ARCHITECTURE.md section 5.3). Pure: the same inputs
// always give the same output, and nothing is mutated, so a seek (Back,
// Replay, scrubbing) is just a call with another time.
import {
  type Action,
  type Anchor,
  type BoardState,
  CELL,
  cellCentre,
  type CuedAction,
  type GridObject,
  gridShape,
  type HighlightColor,
  isGrid,
  isPoint,
  type MatrixObject,
  type ObjectState,
  type PartCopy,
  type Point,
  type SceneObject,
  type Target,
} from "@/shared/scene";
import { heatmapCellCentre, plotPoint } from "@/shared/viz";
import type { CueTimes } from "@/shared/lesson";
import { easeInOutCubic } from "./easing";

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
    if (!Object.hasOwn(cueTimes, action.cue)) continue;
    const startMs = cueTimes[action.cue];
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

/** The colour a highlight sets: its own, or accent by default. The renderer uses it too. */
export function highlightColor(action: {
  color?: HighlightColor;
}): HighlightColor {
  return action.color ?? "accent";
}

/** A part's key, "a:r0", "a:c1" or "a:r0c1"; the renderer uses it to name copies. */
export function partKey(t: Target): string {
  return `${t.id}:${t.row !== undefined ? `r${t.row}` : ""}${
    t.col !== undefined ? `c${t.col}` : ""
  }`;
}

/** Whether a target names a part of a grid object (a row, column or cell), not a whole object. */
export function isPart(t: Target): boolean {
  return t.row !== undefined || t.col !== undefined;
}

/** A grid object's cells all set to `value`, in its shape. */
function grid<T>(obj: GridObject, value: (r: number) => T): T[][] {
  return gridShape(obj).map((n, r) =>
    Array.from({ length: n }, () => value(r)),
  );
}

/** Which cells of a heatmap or plot start drawn: unless hidden, or in a hidden series. */
function initialCellVisible(obj: SceneObject): boolean[][] | undefined {
  if (obj.kind === "heatmap") return grid(obj, () => !obj.cellsHidden);
  if (obj.kind === "plot") return grid(obj, (r) => !obj.series[r].hidden);
  return undefined;
}

function initialBoard(objects: readonly SceneObject[]): Board {
  const states: ObjectState[] = [];
  const byId = new Map<string, ObjectState>();
  for (const source of objects) {
    if (byId.has(source.id)) continue; // first wins, as in validate.ts
    const object = structuredClone(source);
    const state: ObjectState = {
      object,
      visible: !object.hidden,
      highlight: null,
      ...(isGrid(object) ? { cellHighlight: grid(object, () => null) } : {}),
    };
    const cellVisible = initialCellVisible(object);
    if (cellVisible) state.cellVisible = cellVisible;
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

/**
 * Whether a target covers cell (r, c) of its matrix: the whole matrix, the
 * cell's row or column, or the cell itself. The renderer uses it too.
 */
export function coversCell(t: Target, r: number, c: number): boolean {
  return (
    (t.row === undefined || t.row === r) && (t.col === undefined || t.col === c)
  );
}

/** The grid object behind a part target, if the target is a valid part of one. */
function gridPart(
  board: Board,
  t: Target,
): { state: ObjectState; obj: GridObject } | undefined {
  const state = board.byId.get(t.id);
  if (!state || !isGrid(state.object)) return undefined;
  const shape = gridShape(state.object);
  if (t.row !== undefined && (t.row < 0 || t.row >= shape.length))
    return undefined;
  if (t.col !== undefined && t.col < 0) return undefined;
  const cols = t.row !== undefined ? shape[t.row] : Math.min(...shape);
  if (t.col !== undefined && t.col >= cols) return undefined;
  return { state, obj: state.object };
}

/** Cells (r, c) a target covers in its grid object. */
function cellsOf(obj: GridObject, t: Target): [number, number][] {
  const out: [number, number][] = [];
  gridShape(obj).forEach((n, r) => {
    for (let c = 0; c < n; c++) if (coversCell(t, r, c)) out.push([r, c]);
  });
  return out;
}

/** Centre of cell (r, c) of a grid object: a matrix or heatmap cell, a plot point. */
function cellCentreOf(obj: GridObject, r: number, c: number): Point {
  switch (obj.kind) {
    case "matrix":
      return cellCentre(obj.x, obj.y, r, c);
    case "heatmap":
      return heatmapCellCentre(obj, r, c);
    case "plot":
      return plotPoint(obj, r, c);
  }
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
    const part = gridPart(board, t);
    if (!part) return undefined;
    const { obj: g } = part;
    return mean(cellsOf(g, t).map(([r, c]) => cellCentreOf(g, r, c)));
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
    case "heatmap":
    case "plot":
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

function moveObjectCentre(obj: SceneObject, to: Point): void {
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
    case "heatmap":
    case "plot":
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
  if (!isGrid(state.object)) {
    if (!isPart(t) && clears(state.highlight)) state.highlight = color;
    return;
  }
  const part = gridPart(board, t);
  const cells = state.cellHighlight;
  if (!part || !cells) return;
  for (const [r, c] of cellsOf(part.obj, t))
    if (clears(cells[r][c])) cells[r][c] = color;
}

/**
 * Reveals or conceals the cells a part target covers in a heatmap or plot (a plot's series
 * draws on). True when the target is such a part, so the caller handles nothing else.
 */
function setCellsVisible(board: Board, t: Target, visible: boolean): boolean {
  const part = gridPart(board, t);
  const cells = part?.state.cellVisible;
  if (!part || !cells || !isPart(t)) return false;
  for (const [r, c] of cellsOf(part.obj, t)) cells[r][c] = visible;
  return true;
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
      // Visible from the start, so the renderer can fade it in (or draw it on) with progress.
      if (setCellsVisible(board, t, true)) break;
      if (!isPart(t)) state.visible = true;
      break;
    case "hide":
      // Visible until the end, so the renderer can fade it out with progress.
      if (p < 1) break;
      if (setCellsVisible(board, t, false)) break;
      if (!isPart(t)) state.visible = false;
      else {
        const copy = board.copyByKey.get(partKey(t));
        // The copy is removed: the part anchors to its source cells again,
        // and a later move makes a fresh copy. A part that never moved: no change.
        if (copy) {
          board.copies.splice(board.copies.indexOf(copy), 1);
          board.copyByKey.delete(partKey(t));
        }
      }
      break;
    case "highlight":
      setHighlight(board, t, highlightColor(action), undefined);
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
      // Eased (issue #101): it sets off and lands gently, still a pure function of t.
      const at = lerp(plan.from, plan.to, easeInOutCubic(p));
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
  // Only a matrix's parts move (as copies); a heatmap or plot moves whole.
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
 * Whether entry `i` is a hide that a later show of the same object has
 * already finished undoing by `tMs`. The show applies after it, so the object
 * ends visible: the hide no longer fades anything and leaves `active`.
 */
function undoneByShow(
  started: readonly Entry[],
  i: number,
  tMs: number,
): boolean {
  const { action } = started[i];
  if (action.do !== "hide") return false;
  const key = partKey(action.target);
  return started
    .slice(i + 1)
    .some(
      (later) =>
        later.action.do === "show" &&
        !isPart(later.action.target) &&
        partKey(later.action.target) === key &&
        tMs >= later.startMs + later.durationMs,
    );
}

/**
 * When the earlier actions are taken to be, to judge whether an action
 * changes the board. A hide takes effect when it ends, so it is judged
 * against the board then: a shorter hide during a longer one still hides the
 * object first, so it is active. Anything else is judged against every
 * earlier action complete, so a show during a hide in progress is active.
 */
function beforeAt(e: Entry): number {
  return e.action.do === "hide" ? e.startMs + e.durationMs : Infinity;
}

/** Board content only, for comparing two boards. */
function snapshot(board: Board): string {
  return JSON.stringify([board.states, board.copies]);
}

/**
 * Whether an action, once complete, changes `before`. One that doesn't (a
 * show of a visible object, a highlight in the colour its cells already have,
 * a write of the same value, or any action on an unknown or invalid target)
 * is left out of `active`, so the renderer doesn't fade in what is already
 * there. See `beforeAt` for which board it is judged against.
 */
function changesBoard(
  before: Board,
  e: Entry,
  plan: MovePlan | undefined,
): boolean {
  const after = cloneBoard(before);
  apply(after, e, 1, plan);
  return snapshot(after) !== snapshot(before);
}

/** Which part of a cell an action sets, if it sets one. */
type CellField = "highlight" | "value" | "visible";

function cellField(action: Action): CellField | undefined {
  if (action.do === "highlight" || action.do === "unhighlight")
    return "highlight";
  if (action.do === "write") return "value";
  // A show or hide of a heatmap's cells or a plot's series (see `setCellsVisible`).
  if ((action.do === "show" || action.do === "hide") && isPart(action.target))
    return "visible";
  return undefined;
}

/** Cells [r, c] of grid object `id` whose `field` differs between two boards. */
function changedCells(
  before: Board,
  after: Board,
  id: string,
  field: CellField,
): [number, number][] {
  const a = before.byId.get(id);
  const b = after.byId.get(id);
  if (!a || !b || !isGrid(a.object) || !isGrid(b.object)) return [];
  const aRows = a.object.kind === "matrix" ? a.object.rows : undefined;
  const bRows = b.object.kind === "matrix" ? b.object.rows : undefined;
  const out: [number, number][] = [];
  gridShape(b.object).forEach((n, r) => {
    for (let c = 0; c < n; c++) {
      const differs =
        field === "value"
          ? bRows?.[r][c] !== aRows?.[r][c]
          : field === "visible"
            ? b.cellVisible?.[r][c] !== a.cellVisible?.[r][c]
            : b.cellHighlight?.[r][c] !== a.cellHighlight?.[r][c];
      if (differs) out.push([r, c]);
    }
  });
  return out;
}

/**
 * The board at `tMs`: `objects` as the step starts, with every action of
 * `timed` that has started by then applied. Actions apply in start order;
 * actions that start at the same time apply in their array order.
 *
 * - `show`, `highlight`, `unhighlight` and `write` take effect when they
 *   start; `hide` when it ends. `move` slides, eased in and out
 *   (easeInOutCubic), from where its target was when the move started to
 *   where its anchor was then.
 * - `active` lists the actions in progress (start <= t < start + duration)
 *   that change the board, with how far along they are, 0..1. A highlight,
 *   unhighlight or write on a matrix also lists the cells it changed that no
 *   later started action has changed since, so the renderer fades only those.
 * - Actions on unknown or invalid targets are ignored (validate.ts rejects
 *   them before they reach the player).
 */
export function sceneAt(
  objects: readonly SceneObject[],
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

  // The board each started action is judged against (`beforeAt`), built once.
  const befores = new Map<number, Board>();
  const beforeOf = (i: number): Board => {
    let before = befores.get(i);
    if (!before) {
      before = run(base, started.slice(0, i), plans, beforeAt(started[i]));
      befores.set(i, before);
    }
    return before;
  };

  // The cells each started cell action changed, judged like `changesBoard`.
  // Computed only when needed.
  const cellChanges = new Map<number, Set<string>>();
  const changedBy = (i: number): Set<string> => {
    let cells = cellChanges.get(i);
    if (!cells) {
      const e = started[i];
      const field = cellField(e.action);
      const before = beforeOf(i);
      const after = cloneBoard(before);
      apply(after, e, 1, plans[i]);
      cells = new Set(
        field
          ? changedCells(before, after, e.action.target.id, field).map(
              ([r, c]) => `${r},${c}`,
            )
          : [],
      );
      cellChanges.set(i, cells);
    }
    return cells;
  };
  /** Cells entry `i` changed that no later started action has changed since. */
  const cellsStillSet = (i: number): [number, number][] => {
    const { action } = started[i];
    const field = cellField(action);
    const left = new Set(changedBy(i));
    for (let j = i + 1; j < started.length && left.size; j++) {
      const later = started[j].action;
      if (later.target.id !== action.target.id || cellField(later) !== field)
        continue;
      for (const cell of changedBy(j)) left.delete(cell);
    }
    return [...left].map((k) => k.split(",").map(Number) as [number, number]);
  };

  const board = run(base, started, plans, tMs);
  return {
    objects: board.states,
    copies: board.copies,
    active: started.flatMap((e, i) => {
      if (
        e.durationMs <= 0 ||
        tMs >= e.startMs + e.durationMs ||
        undoneByShow(started, i, tMs) ||
        !changesBoard(beforeOf(i), e, plans[i])
      )
        return [];
      const target = base.byId.get(e.action.target.id)?.object;
      const field = cellField(e.action);
      // A matrix part's show or hide is about its copy, not its cells: no `cells`.
      const onGrid =
        field !== undefined &&
        target !== undefined &&
        isGrid(target) &&
        !(field === "visible" && target.kind === "matrix");
      return [
        {
          action: structuredClone(e.action),
          progress: progressAt(e, tMs),
          ...(onGrid ? { cells: cellsStillSet(i) } : {}),
        },
      ];
    }),
  };
}
