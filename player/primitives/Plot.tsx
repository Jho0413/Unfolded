// A plot (issue #103): axes with ticks and labels, and sampled series drawn as lines or
// points. A series shown on a cue draws on along x with the show's progress; a series or a
// point can be highlighted.
import { useId } from "react";
import type {
  ActiveAction,
  HighlightColor,
  ObjectState,
  PlotObject,
} from "@/shared/scene";
import { VIZ_FONT, formatTick, niceTicks, plotLayout } from "@/shared/viz";
import {
  HIGHLIGHT,
  INK,
  MUTED,
  cellProgress,
  fadeOpacity,
  highlightAttr,
  opacityAttr,
} from "./style";
import styles from "./Viz.module.css";
import { drawnPoints, revealOf, seriesColor } from "./vizStyle";

const TICK = 6;
const STROKE = 3.5;
const DOT = 5;

/** The colour every point of a series is highlighted in, or null if they differ or none is. */
function wholeHighlight(row: readonly (HighlightColor | null)[] | undefined) {
  const first = row?.[0] ?? null;
  return first !== null && row?.every((h) => h === first) ? first : null;
}

export function Plot({
  plot,
  state,
  active,
}: {
  /** `state.object`, narrowed by the caller. */
  plot: PlotObject;
  state: ObjectState;
  active: readonly ActiveAction[];
}) {
  const clipId = `plot-clip-${useId().replace(/:/g, "")}`;
  const { area, toCanvas } = plotLayout(plot);
  const opacity = state.visible ? fadeOpacity(active, { id: plot.id }) : 0;
  const xTicks = niceTicks(plot.xRange[0], plot.xRange[1]);
  const yTicks = niceTicks(plot.yRange[0], plot.yRange[1]);
  const bottom = area.y + area.h;
  const xAt = (x: number) => toCanvas(x, plot.yRange[0]).x;
  const yAt = (y: number) => toCanvas(plot.xRange[0], y).y;
  const legend = plot.series.flatMap((s, i) => (s.label ? [{ s, i }] : []));
  return (
    <g
      data-object-id={plot.id}
      data-kind="plot"
      data-visible={String(state.visible)}
      data-opacity={opacityAttr(opacity)}
      data-left={plot.x}
      data-top={plot.y}
      data-cx={plot.x + plot.w / 2}
      data-cy={plot.y + plot.h / 2}
      className={styles.viz}
      opacity={opacity}
      visibility={state.visible ? undefined : "hidden"}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={area.x} y={area.y} width={area.w} height={area.h} />
        </clipPath>
      </defs>
      <g data-axes fontSize={VIZ_FONT.tick} fill={MUTED}>
        {xTicks.map((t, i) => (
          <g key={`x${i}`} data-x-tick={t}>
            <line
              x1={xAt(t)}
              x2={xAt(t)}
              y1={area.y}
              y2={bottom}
              stroke="var(--wb-grid)"
            />
            <line
              x1={xAt(t)}
              x2={xAt(t)}
              y1={bottom}
              y2={bottom + TICK}
              stroke={INK}
            />
            <text
              x={xAt(t)}
              y={bottom + TICK + 4}
              textAnchor="middle"
              dominantBaseline="hanging"
            >
              {formatTick(t)}
            </text>
          </g>
        ))}
        {yTicks.map((t, i) => (
          <g key={`y${i}`} data-y-tick={t}>
            <line
              x1={area.x}
              x2={area.x + area.w}
              y1={yAt(t)}
              y2={yAt(t)}
              stroke="var(--wb-grid)"
            />
            <line
              x1={area.x - TICK}
              x2={area.x}
              y1={yAt(t)}
              y2={yAt(t)}
              stroke={INK}
            />
            <text
              x={area.x - TICK - 4}
              y={yAt(t)}
              textAnchor="end"
              dominantBaseline="central"
            >
              {formatTick(t)}
            </text>
          </g>
        ))}
        <path
          d={`M ${area.x} ${area.y} V ${bottom} H ${area.x + area.w}`}
          fill="none"
          stroke={INK}
          strokeWidth={2}
        />
        {plot.xLabel && (
          <text
            data-x-label
            x={area.x + area.w / 2}
            y={plot.y + plot.h}
            textAnchor="middle"
            fontSize={VIZ_FONT.axis}
          >
            {plot.xLabel}
          </text>
        )}
        {plot.yLabel && (
          <text
            data-y-label
            transform={`translate(${plot.x + VIZ_FONT.axis} ${area.y + area.h / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={VIZ_FONT.axis}
          >
            {plot.yLabel}
          </text>
        )}
      </g>
      <g clipPath={`url(#${clipId})`}>
        {plot.series.map((series, s) => {
          const color = seriesColor(s);
          const joined = series.style !== "points";
          const visibleRow = state.cellVisible?.[s];
          const drawn = visibleRow?.[0] ?? true;
          const { draw, fade } = revealOf(active, plot.id, s, 0);
          const progress = drawn ? draw : 0;
          const pts = drawnPoints(series.points, progress, joined).map(
            ([x, y]) => toCanvas(x, y),
          );
          const hlRow = state.cellHighlight?.[s];
          const whole = wholeHighlight(hlRow);
          const wholeP = whole
            ? cellProgress(active, "highlight", plot.id, s, 0, whole)
            : 0;
          const d = pts
            .map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`)
            .join(" ");
          return (
            <g
              key={s}
              data-series={s}
              data-drawn={String(drawn)}
              data-draw-progress={opacityAttr(progress)}
              data-drawn-points={pts.length}
              data-fade={opacityAttr(drawn ? fade : 0)}
              data-highlight={highlightAttr(whole)}
              data-highlight-opacity={opacityAttr(wholeP)}
              opacity={fade}
            >
              {whole && joined && pts.length > 1 && (
                <path
                  d={d}
                  fill="none"
                  stroke={HIGHLIGHT[whole].stroke}
                  strokeOpacity={0.45}
                  strokeWidth={STROKE + 9}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={wholeP}
                />
              )}
              {joined && pts.length > 1 && (
                <path
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {!joined &&
                pts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={DOT} fill={color} />
                ))}
              {/* Highlighted points (or every point of a highlighted points series) get a ring. */}
              {series.points.map((_, i) => {
                const h = hlRow?.[i] ?? null;
                if (!h || i >= pts.length || (whole && joined)) return null;
                const at = toCanvas(series.points[i][0], series.points[i][1]);
                return (
                  <circle
                    key={`hl${i}`}
                    data-point={`${s},${i}`}
                    data-highlight={h}
                    cx={at.x}
                    cy={at.y}
                    r={DOT + 5}
                    fill={HIGHLIGHT[h].fill}
                    stroke={HIGHLIGHT[h].stroke}
                    strokeWidth={3}
                    opacity={cellProgress(
                      active,
                      "highlight",
                      plot.id,
                      s,
                      i,
                      h,
                    )}
                  />
                );
              })}
            </g>
          );
        })}
      </g>
      {legend.length > 0 && (
        <g data-legend fontSize={VIZ_FONT.label} fill={INK}>
          {legend.map(({ s, i }, k) => {
            const drawn = state.cellVisible?.[i]?.[0] ?? true;
            const y = area.y + 14 + k * VIZ_FONT.label * 1.4;
            return (
              <g key={i} data-legend-entry={i} opacity={drawn ? 1 : 0}>
                <line
                  x1={area.x + 14}
                  x2={area.x + 40}
                  y1={y}
                  y2={y}
                  stroke={seriesColor(i)}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                />
                <text x={area.x + 48} y={y} dominantBaseline="central">
                  {s.label}
                </text>
              </g>
            );
          })}
        </g>
      )}
    </g>
  );
}
