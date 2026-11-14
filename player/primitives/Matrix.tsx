// A matrix: its cells (values and per-cell highlight), brackets and label,
// plus the moved copies of its rows, columns and cells.
import {
  type ActiveAction,
  CELL,
  type HighlightColor,
  type MatrixObject,
  type ObjectState,
  type PartCopy,
} from "@/shared/scene";
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

const BRACKET_GAP = 6;
const BRACKET_SERIF = 10;
const LABEL_FONT = 28;

interface CellProps {
  matrix: MatrixObject;
  r: number;
  c: number;
  /** Top-left corner of the cell on the board. */
  x: number;
  y: number;
  highlight: HighlightColor | null;
  active: readonly ActiveAction[];
}

/** One cell: highlight behind, value on top. Both fade in while being set. */
function Cell({ matrix, r, c, x, y, highlight, active }: CellProps) {
  const value = matrix.rows[r][c];
  const hlProgress = cellProgress(active, "highlight", matrix.id, r, c);
  const writeProgress = cellProgress(active, "write", matrix.id, r, c);
  return (
    <g
      data-cell={`${r},${c}`}
      data-row={r}
      data-col={c}
      data-value={value}
      data-highlight={highlightAttr(highlight)}
    >
      {highlight && (
        <rect
          x={x + 2}
          y={y + 2}
          width={CELL.w - 4}
          height={CELL.h - 4}
          rx={6}
          fill={HIGHLIGHT[highlight].fill}
          stroke={HIGHLIGHT[highlight].stroke}
          strokeWidth={2}
          opacity={hlProgress}
        />
      )}
      <text
        x={x + CELL.w / 2}
        y={y + CELL.h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={CELL_FONT}
        fill={INK}
        opacity={writeProgress}
      >
        {value}
      </text>
    </g>
  );
}

/** Square brackets just outside a w x h cell box at (x, y). */
function Brackets({
  x,
  y,
  w,
  h,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  const top = y - BRACKET_GAP;
  const bottom = y + h + BRACKET_GAP;
  const left = x - BRACKET_GAP;
  const right = x + w + BRACKET_GAP;
  return (
    <g fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round">
      <path
        d={`M ${left + BRACKET_SERIF} ${top} H ${left} V ${bottom} H ${left + BRACKET_SERIF}`}
      />
      <path
        d={`M ${right - BRACKET_SERIF} ${top} H ${right} V ${bottom} H ${right - BRACKET_SERIF}`}
      />
    </g>
  );
}

export function Matrix({
  state,
  active,
}: {
  state: ObjectState;
  active: readonly ActiveAction[];
}) {
  const matrix = state.object as MatrixObject;
  const nRows = matrix.rows.length;
  const nCols = matrix.rows[0].length;
  const w = nCols * CELL.w;
  const h = nRows * CELL.h;
  const opacity = state.visible ? fadeOpacity(active, { id: matrix.id }) : 0;
  return (
    <g
      data-object-id={matrix.id}
      data-kind="matrix"
      data-visible={String(state.visible)}
      data-opacity={opacityAttr(opacity)}
      data-x={matrix.x}
      data-y={matrix.y}
      opacity={opacity}
      visibility={state.visible ? undefined : "hidden"}
    >
      {matrix.label && (
        <text
          data-label
          x={matrix.x + w / 2}
          y={matrix.y - BRACKET_GAP - 18}
          textAnchor="middle"
          fontSize={LABEL_FONT}
          fontWeight={600}
          fill={MUTED}
        >
          {matrix.label}
        </text>
      )}
      <Brackets x={matrix.x} y={matrix.y} w={w} h={h} />
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
          />
        )),
      )}
    </g>
  );
}

/** "a:r0", "a:c1", "a:r0c1": the same part key sceneAt uses. */
export function copyKey(copy: PartCopy): string {
  const { id, row, col } = copy.source;
  return `${id}:${row !== undefined ? `r${row}` : ""}${col !== undefined ? `c${col}` : ""}`;
}

/**
 * A moved copy of a matrix row, column or cell, centred on (copy.x, copy.y).
 * Its values and highlight come from the source cells as they are now, so a
 * later write or highlight on the part shows on the copy too.
 */
export function Copy({
  copy,
  source,
  active,
}: {
  copy: PartCopy;
  source: ObjectState;
  active: readonly ActiveAction[];
}) {
  const matrix = source.object as MatrixObject;
  const { row, col } = copy.source;
  const rows = row !== undefined ? [row] : matrix.rows.map((_, r) => r);
  const cols = col !== undefined ? [col] : matrix.rows[0].map((_, c) => c);
  const w = cols.length * CELL.w;
  const h = rows.length * CELL.h;
  const left = copy.x - w / 2;
  const top = copy.y - h / 2;
  const opacity = copy.visible ? fadeOpacity(active, copy.source) : 0;
  return (
    <g
      data-copy-of={copyKey(copy)}
      data-visible={String(copy.visible)}
      data-opacity={opacityAttr(opacity)}
      data-x={copy.x}
      data-y={copy.y}
      opacity={opacity}
      visibility={copy.visible ? undefined : "hidden"}
    >
      <rect
        x={left - 4}
        y={top - 4}
        width={w + 8}
        height={h + 8}
        rx={8}
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
          />
        )),
      )}
    </g>
  );
}
