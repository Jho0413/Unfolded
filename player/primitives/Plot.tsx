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
import { easeOutCubic, span } from "@/player/easing";
import {
  appearance,
  drawAttr,
  drawOnProps,
  highlightLook,
  motionProps,
  quickFade,
} from "./motion";
import { PulseRing } from "./Pulse";
import styles from "./Viz.module.css";
import { drawnPoints, lengthShareAt, revealOf, seriesColor } from "./vizStyle";

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
  // Arrives as a stroke (motion.ts): its axes draw on with the show.
  const look = appearance(active, { id: plot.id }, state.visible, "stroke");
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
      data-draw={drawAttr(look.draw)}
      data-left={plot.x}
      data-top={plot.y}
      data-cx={plot.x + plot.w / 2}
      data-cy={plot.y + plot.h / 2}
      opacity={look.opacity}
      {...motionProps(look, styles.viz)}
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
          {...drawOnProps(look.draw)}
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
          const drawn = state.cellVisible?.[s]?.[0] ?? true;
          if (!drawn)
            return (
              <g
                key={s}
                data-series={s}
                data-drawn="false"
                data-draw-progress="0"
                data-draw="0"
                data-drawn-points={0}
              />
            );
          const { draw: progress, fade } = revealOf(active, plot.id, s, 0);
          // The pen travels along x with the show's eased progress (motion.ts), and the full
          // path is dashed to where it stands, so reduced motion (board.css) shows it whole.
          const eased = easeOutCubic(progress);
          const all = series.points.map(([x, y]) => toCanvas(x, y));
          const xs = series.points.map(([x]) => x);
          const [lo, hi] = [Math.min(...xs), Math.max(...xs)];
          const cut = lo + eased * (hi - lo);
          const count = drawnPoints(series.points, eased, false).length;
          const share =
            progress >= 1 ? 1 : lengthShareAt(all, toCanvas(cut, 0).x);
          const drawing = progress < 1;
          const ink = drawing ? easeOutCubic(span(progress, 0, 0.2)) : 1;
          const d = all
            .map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`)
            .join(" ");
          const hlRow = state.cellHighlight?.[s];
          const whole = wholeHighlight(hlRow);
          const wholeP = whole
            ? cellProgress(active, "highlight", plot.id, s, 0, whole)
            : 0;
          const wholeLook = highlightLook(wholeP);
          return (
            <g
              key={s}
              data-series={s}
              data-drawn="true"
              data-draw-progress={opacityAttr(progress)}
              data-draw={drawAttr(share)}
              data-drawn-points={count}
              data-fade={opacityAttr(fade)}
              data-highlight={highlightAttr(whole)}
              data-highlight-opacity={opacityAttr(wholeP)}
              opacity={ink * fade}
              {...(drawing ? motionProps({ quick: quickFade(progress) }) : {})}
            >
              {whole && joined && (
                <path
                  d={d}
                  fill="none"
                  stroke={HIGHLIGHT[whole].stroke}
                  strokeOpacity={0.45}
                  strokeWidth={STROKE + 9}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={wholeLook.opacity}
                  {...drawOnProps(share)}
                />
              )}
              {joined && (
                <path
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  {...drawOnProps(share)}
                />
              )}
              {!joined &&
                all.map((p, i) => {
                  const on = series.points[i][0] <= cut || progress >= 1;
                  return (
                    <circle
                      key={i}
                      cx={p.x}
                      cy={p.y}
                      r={DOT}
                      fill={color}
                      {...(on ? {} : { className: "wb-stagger", opacity: 0 })}
                    />
                  );
                })}
              {/* Highlighted points (or every point of a highlighted points series) get a ring. */}
              {series.points.map((_, i) => {
                const h = hlRow?.[i] ?? null;
                if (!h || (whole && joined)) return null;
                const hl = highlightLook(
                  cellProgress(active, "highlight", plot.id, s, i, h),
                );
                const at = all[i];
                const r = DOT + 5;
                return (
                  <g key={`hl${i}`} data-point={`${s},${i}`} data-highlight={h}>
                    <circle
                      {...motionProps(hl, "wb-glow", {
                        "--hl": HIGHLIGHT[h].stroke,
                      })}
                      cx={at.x}
                      cy={at.y}
                      r={r}
                      fill={HIGHLIGHT[h].fill}
                      stroke={HIGHLIGHT[h].stroke}
                      strokeWidth={3}
                      opacity={hl.opacity}
                    />
                    <PulseRing
                      x={at.x - r}
                      y={at.y - r}
                      w={2 * r}
                      h={2 * r}
                      rx={r}
                      color={HIGHLIGHT[h].stroke}
                      pulse={hl.pulse}
                    />
                  </g>
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
