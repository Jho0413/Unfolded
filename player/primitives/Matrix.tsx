// A matrix: its cells (values and per-cell highlight), brackets and label,
// plus the moved copies of its rows, columns and cells. While it is shown, its
// brackets draw on, its label rises in and its cells fill in reading order
// (./motion.ts); a new highlight pulses once.
import {
  type ActiveAction,
  CELL,
  type HighlightColor,
  type MatrixObject,
  type ObjectState,
  type PartCopy,
} from "@/shared/scene";
import { MATRIX_FRAME } from "@/shared/boxes";
import { partKey } from "@/player/sceneAt";
import { easeOutCubic, span } from "@/player/easing";
import {
  RISE_PX,
  appearance,
  drawAttr,
  drawOnProps,
  highlightLook,
  staggerIn,
  useReducedMotion,
  writeOpacity,
} from "./motion";
import { PulseRing } from "./Pulse";
import {
  CELL_FONT,
  COPY_STROKE,
  BOARD_BG,
  HIGHLIGHT,
  INK,
  MUTED,
  cellProgress,
  fadeOpacity,
  highlightAttr,
  opacityAttr,
} from "./style";

const {
  bracketGap: BRACKET_GAP,
  bracketSerif: BRACKET_SERIF,
  labelFont: LABEL_FONT,
  labelLift: LABEL_LIFT,
} = MATRIX_FRAME;
/** Bracket and highlight strokes. */
const BRACKET_STROKE = 2.5;
const HL_INSET = 3;
const HL_RADIUS = 8;

interface CellProps {
  matrix: MatrixObject;
  r: number;
  c: number;
  /** Top-left corner of the cell on the board. */
  x: number;
  y: number;
  highlight: HighlightColor | null;
  active: readonly ActiveAction[];
  reduced: boolean;
  /** The cell's share of its matrix's entrance (1 when not entering). */
  enter?: number;
}

/** One cell: highlight behind, value on top. Both fade in while being set. */
function Cell({
  matrix,
  r,
  c,
  x,
  y,
  highlight,
  active,
  reduced,
  enter = 1,
}: CellProps) {
  const value = matrix.rows[r][c];
  const hlProgress = cellProgress(
    active,
    "highlight",
    matrix.id,
    r,
    c,
    highlight,
  );
  const writeProgress = cellProgress(active, "write", matrix.id, r, c, value);
  const look = highlightLook(hlProgress, reduced);
  const hlBox = {
    x: x + HL_INSET,
    y: y + HL_INSET,
    w: CELL.w - 2 * HL_INSET,
    h: CELL.h - 2 * HL_INSET,
  };
  return (
    <g
      data-cell={`${r},${c}`}
      data-row={r}
      data-col={c}
      data-value={value}
      data-highlight={highlightAttr(highlight)}
      data-highlight-opacity={opacityAttr(highlight ? hlProgress : 0)}
      data-value-opacity={opacityAttr(writeProgress)}
      opacity={enter < 1 ? enter : undefined}
    >
      {highlight && (
        <>
          <rect
            className="wb-glow"
            style={{ ["--hl" as string]: HIGHLIGHT[highlight].stroke }}
            x={hlBox.x}
            y={hlBox.y}
            width={hlBox.w}
            height={hlBox.h}
            rx={HL_RADIUS}
            fill={HIGHLIGHT[highlight].fill}
            stroke={HIGHLIGHT[highlight].stroke}
            strokeWidth={1.75}
            opacity={look.opacity}
          />
          <PulseRing
            {...hlBox}
            rx={HL_RADIUS}
            color={HIGHLIGHT[highlight].stroke}
            pulse={look.pulse}
          />
        </>
      )}
      <text
        x={x + CELL.w / 2}
        y={y + CELL.h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={CELL_FONT}
        fill={INK}
        opacity={writeOpacity(writeProgress, reduced)}
      >
        {value}
      </text>
    </g>
  );
}

/** Square brackets just outside a w x h cell box at (x, y), drawn on to `draw` (0..1). */
function Brackets({
  x,
  y,
  w,
  h,
  draw,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  draw: number;
}) {
  const top = y - BRACKET_GAP;
  const bottom = y + h + BRACKET_GAP;
  const left = x - BRACKET_GAP;
  const right = x + w + BRACKET_GAP;
  return (
    <g
      data-brackets
      fill="none"
      stroke={INK}
      strokeWidth={BRACKET_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        {...drawOnProps(draw)}
        d={`M ${left + BRACKET_SERIF} ${top} H ${left} V ${bottom} H ${left + BRACKET_SERIF}`}
      />
      <path
        {...drawOnProps(draw)}
        d={`M ${right - BRACKET_SERIF} ${top} H ${right} V ${bottom} H ${right - BRACKET_SERIF}`}
      />
    </g>
  );
}

export function Matrix({
  matrix,
  state,
  active,
}: {
  /** `state.object`, narrowed by the caller. */
  matrix: MatrixObject;
  state: ObjectState;
  active: readonly ActiveAction[];
}) {
  const nRows = matrix.rows.length;
  const nCols = matrix.rows[0].length;
  const w = nCols * CELL.w;
  const h = nRows * CELL.h;
  const opacity = state.visible ? fadeOpacity(active, { id: matrix.id }) : 0;
  const reduced = useReducedMotion();
  const look = appearance(
    active,
    { id: matrix.id },
    state.visible,
    "stroke",
    reduced,
  );
  const labelIn = reduced ? 1 : easeOutCubic(span(look.enter, 0.1, 0.5));
  const nCells = nRows * nCols;
  return (
    <g
      data-object-id={matrix.id}
      data-kind="matrix"
      data-visible={String(state.visible)}
      data-opacity={opacityAttr(opacity)}
      data-draw={drawAttr(look.draw)}
      data-left={matrix.x}
      data-top={matrix.y}
      data-cx={matrix.x + w / 2}
      data-cy={matrix.y + h / 2}
      opacity={look.opacity}
      visibility={state.visible ? undefined : "hidden"}
    >
      {matrix.label && (
        <text
          data-label
          x={matrix.x + w / 2}
          y={matrix.y - BRACKET_GAP - LABEL_LIFT + (1 - labelIn) * RISE_PX}
          textAnchor="middle"
          fontSize={LABEL_FONT}
          fontWeight={600}
          letterSpacing={0.5}
          fill={MUTED}
          opacity={labelIn < 1 ? labelIn : undefined}
        >
          {matrix.label}
        </text>
      )}
      <Brackets x={matrix.x} y={matrix.y} w={w} h={h} draw={look.draw} />
      {matrix.rows.map((row, r) =>
        row.map((_, c) => (
          <Cell
            key={`${r},${c}`}
            matrix={matrix}
            r={r}
            c={c}
            x={matrix.x + c * CELL.w}
            y={matrix.y + r * CELL.h}
            highlight={state.cellHighlight?.[r]?.[c] ?? null}
            active={active}
            reduced={reduced}
            enter={staggerIn(look.enter, r * nCols + c, nCells, reduced)}
          />
        )),
      )}
    </g>
  );
}

/**
 * A moved copy of a matrix row, column or cell, centred on (copy.x, copy.y).
 * Its values and highlight come from the source cells as they are now, so a
 * later write or highlight on the part shows on the copy too. Its cells keep
 * their source indices: the first cell of a copy of row 1 is data-cell="1,0".
 */
export function Copy({
  copy,
  matrix,
  source,
  active,
}: {
  copy: PartCopy;
  /** The source matrix, `source.object` narrowed by the caller. */
  matrix: MatrixObject;
  source: ObjectState;
  active: readonly ActiveAction[];
}) {
  const { row, col } = copy.source;
  const rows = row !== undefined ? [row] : matrix.rows.map((_, r) => r);
  const cols = col !== undefined ? [col] : matrix.rows[0].map((_, c) => c);
  const w = cols.length * CELL.w;
  const h = rows.length * CELL.h;
  const left = copy.x - w / 2;
  const top = copy.y - h / 2;
  const opacity = copy.visible ? fadeOpacity(active, copy.source) : 0;
  const reduced = useReducedMotion();
  return (
    <g
      data-copy-of={partKey(copy.source)}
      data-visible={String(copy.visible)}
      data-opacity={opacityAttr(opacity)}
      data-cx={copy.x}
      data-cy={copy.y}
      opacity={opacity}
      visibility={copy.visible ? undefined : "hidden"}
    >
      <rect
        className="wb-lift"
        x={left - 4}
        y={top - 4}
        width={w + 8}
        height={h + 8}
        rx={10}
        fill={BOARD_BG}
        stroke={COPY_STROKE}
        strokeWidth={2}
      />
      {rows.map((r, i) =>
        cols.map((c, j) => (
          <Cell
            key={`${r},${c}`}
            matrix={matrix}
            r={r}
            c={c}
            x={left + j * CELL.w}
            y={top + i * CELL.h}
            highlight={source.cellHighlight?.[r]?.[c] ?? null}
            active={active}
            reduced={reduced}
          />
        )),
      )}
    </g>
  );
}
