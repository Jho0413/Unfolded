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
import { easeOutCubic } from "@/player/easing";
import {
  appearance,
  drawAttr,
  highlightLook,
  motionProps,
  quickFade,
  staggerIn,
} from "./motion";
import { PulseRing } from "./Pulse";
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
import { FitLines } from "./FitLines";
import { fitText } from "./fitText";
import styles from "./Viz.module.css";
import { heatColor, heatTextColor, revealOf, revealOrder } from "./vizStyle";

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
  // Arrives as a matrix does (motion.ts): the frame and labels ink in at once.
  const look = appearance(active, { id: heatmap.id }, state.visible, "stroke");
  const nRows = heatmap.values.length;
  const nCols = heatmap.values[0].length;
  const valueFont = Math.min(
    VIZ_FONT.label,
    cellH * 0.45,
    cellW /
      (0.6 *
        Math.max(1, ...heatmap.values.flat().map((v) => formatTick(v).length))),
  );
  // A column label shrinks to its column (QA A3); one line, squeezed if it must be.
  const colFit = (heatmap.colLabels ?? []).map((label) =>
    fitText(
      label,
      { w: cellW - 4, h: VIZ_FONT.label * 1.2 },
      { max: VIZ_FONT.label, min: 11 },
    ),
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
      data-draw={drawAttr(look.draw)}
      data-left={heatmap.x}
      data-top={heatmap.y}
      data-cx={heatmap.x + heatmap.w / 2}
      data-cy={heatmap.y + heatmap.h / 2}
      opacity={look.opacity}
      {...motionProps(look, styles.viz)}
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
          fontSize={colFit[c].fontSize}
          fill={MUTED}
        >
          <FitLines
            fitted={colFit[c]}
            x={grid.x + (c + 0.5) * cellW}
            boxW={cellW - 4}
          />
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
        const { draw, fade, by } = revealOf(active, heatmap.id, r, c);
        const shown = revealed ? draw * fade : 0;
        // Drawn: a revealed row fills in left to right behind the pen, eased (motion.ts).
        const order = by && revealOrder(by, r, c, nRows, nCols);
        const fill = revealed
          ? (order ? staggerIn(draw, order.i, order.n) : easeOutCubic(draw)) *
            fade
          : 0;
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
              <g
                opacity={fill}
                {...(draw < 1
                  ? motionProps({ quick: quickFade(draw) * fade }, "wb-stagger")
                  : {})}
              >
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
      {cells.map(({ r, c, highlight, x, y }) => {
        if (!highlight) return null;
        const hl = highlightLook(
          cellProgress(active, "highlight", heatmap.id, r, c, highlight),
        );
        const box = { x: x + 2, y: y + 2, w: cellW - 4, h: cellH - 4 };
        return (
          <g key={`hl${r},${c}`} data-highlight-of={`${r},${c}`}>
            <rect
              {...motionProps(hl, "wb-glow", {
                "--hl": HIGHLIGHT[highlight].stroke,
              })}
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx={4}
              fill="none"
              stroke={HIGHLIGHT[highlight].stroke}
              strokeWidth={4}
              opacity={hl.opacity}
            />
            <PulseRing
              {...box}
              rx={4}
              color={HIGHLIGHT[highlight].stroke}
              pulse={hl.pulse}
            />
          </g>
        );
      })}
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
