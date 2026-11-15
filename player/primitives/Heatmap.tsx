// A heatmap (issue #103): a grid of values as coloured cells, with optional row and column
// labels, values and title. Cells can be revealed one by one (`cellsHidden`, then shows on
// rows, columns or cells) and highlighted like a matrix's.
import type {
  ActiveAction,
  HeatmapObject,
  HighlightColor,
  ObjectState,
} from "@/shared/scene";
import {
  VIZ_FONT,
  formatTick,
  heatmapLayout,
  heatmapLevel,
} from "@/shared/viz";
import {
  BOARD_BG,
  HIGHLIGHT,
  INK,
  MUTED,
  cellProgress,
  fadeOpacity,
  highlightAttr,
  opacityAttr,
} from "./style";
import styles from "./Viz.module.css";
import { heatColor, heatTextColor, revealOf } from "./vizStyle";

const LABEL_GAP = 8;

export function Heatmap({
  heatmap,
  state,
  active,
}: {
  /** `state.object`, narrowed by the caller. */
  heatmap: HeatmapObject;
  state: ObjectState;
  active: readonly ActiveAction[];
}) {
  const { grid, cellW, cellH } = heatmapLayout(heatmap);
  const opacity = state.visible ? fadeOpacity(active, { id: heatmap.id }) : 0;
  const valueFont = Math.min(
    VIZ_FONT.label,
    cellH * 0.45,
    cellW /
      (0.6 *
        Math.max(1, ...heatmap.values.flat().map((v) => formatTick(v).length))),
  );
  const cells = heatmap.values.flatMap((row, r) =>
    row.map((value, c) => {
      const revealed = state.cellVisible?.[r]?.[c] ?? true;
      const highlight: HighlightColor | null =
        state.cellHighlight?.[r]?.[c] ?? null;
      return {
        r,
        c,
        value,
        revealed,
        highlight,
        x: grid.x + c * cellW,
        y: grid.y + r * cellH,
      };
    }),
  );
  return (
    <g
      data-object-id={heatmap.id}
      data-kind="heatmap"
      data-visible={String(state.visible)}
      data-opacity={opacityAttr(opacity)}
      data-left={heatmap.x}
      data-top={heatmap.y}
      data-cx={heatmap.x + heatmap.w / 2}
      data-cy={heatmap.y + heatmap.h / 2}
      className={styles.viz}
      opacity={opacity}
      visibility={state.visible ? undefined : "hidden"}
    >
      {heatmap.label && (
        <text
          data-label
          x={heatmap.x + heatmap.w / 2}
          y={heatmap.y - 18}
          textAnchor="middle"
          fontSize={VIZ_FONT.title}
          fontWeight={600}
          fill={MUTED}
        >
          {heatmap.label}
        </text>
      )}
      {heatmap.colLabels?.map((label, c) => (
        <text
          key={`c${c}`}
          data-col-label={c}
          x={grid.x + (c + 0.5) * cellW}
          y={grid.y - LABEL_GAP}
          textAnchor="middle"
          fontSize={VIZ_FONT.label}
          fill={MUTED}
        >
          {label}
        </text>
      ))}
      {heatmap.rowLabels?.map((label, r) => (
        <text
          key={`r${r}`}
          data-row-label={r}
          x={grid.x - LABEL_GAP}
          y={grid.y + (r + 0.5) * cellH}
          textAnchor="end"
          dominantBaseline="central"
          fontSize={VIZ_FONT.label}
          fill={MUTED}
        >
          {label}
        </text>
      ))}
      {cells.map(({ r, c, value, revealed, highlight, x, y }) => {
        const level = heatmapLevel(heatmap, value);
        const { draw, fade } = revealOf(active, heatmap.id, r, c);
        const shown = revealed ? draw * fade : 0;
        const hl = highlight
          ? cellProgress(active, "highlight", heatmap.id, r, c, highlight)
          : 0;
        return (
          <g
            key={`${r},${c}`}
            data-cell={`${r},${c}`}
            data-row={r}
            data-col={c}
            data-value={value}
            data-level={opacityAttr(level)}
            data-revealed={String(revealed)}
            data-reveal-opacity={opacityAttr(shown)}
            data-highlight={highlightAttr(highlight)}
            data-highlight-opacity={opacityAttr(hl)}
          >
            {/* An unrevealed cell keeps its place as a faint outline. */}
            <rect
              x={x + 1}
              y={y + 1}
              width={cellW - 2}
              height={cellH - 2}
              rx={3}
              fill="none"
              stroke="var(--wb-heat-empty)"
              strokeWidth={1.5}
            />
            {shown > 0 && (
              <g opacity={shown}>
                <rect
                  x={x}
                  y={y}
                  width={cellW}
                  height={cellH}
                  fill={heatColor(level)}
                  stroke={BOARD_BG}
                  strokeWidth={1.5}
                />
                {heatmap.showValues && (
                  <text
                    x={x + cellW / 2}
                    y={y + cellH / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={valueFont}
                    fill={heatTextColor(level)}
                  >
                    {formatTick(value)}
                  </text>
                )}
              </g>
            )}
          </g>
        );
      })}
      {/* Highlights go over every cell, so a neighbour never covers an outline. */}
      {cells.map(({ r, c, highlight, x, y }) =>
        highlight ? (
          <rect
            key={`hl${r},${c}`}
            data-highlight-of={`${r},${c}`}
            x={x + 2}
            y={y + 2}
            width={cellW - 4}
            height={cellH - 4}
            rx={4}
            fill="none"
            stroke={HIGHLIGHT[highlight].stroke}
            strokeWidth={4}
            opacity={cellProgress(
              active,
              "highlight",
              heatmap.id,
              r,
              c,
              highlight,
            )}
          />
        ) : null,
      )}
      <rect
        x={grid.x}
        y={grid.y}
        width={grid.w}
        height={grid.h}
        fill="none"
        stroke={INK}
        strokeOpacity={0.35}
        strokeWidth={1.5}
      />
    </g>
  );
}
