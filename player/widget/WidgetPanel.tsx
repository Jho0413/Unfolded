"use client";
// The "try it yourself" panel (issue #110): at the end of a step, a small widget the learner
// plays with. A plot widget redraws its curve as its sliders move; a heatmap widget shows its
// editable scores live (through softmax per row, with a temperature slider, if it says so).
// Its state is its own: nothing here touches the lesson's clock or the player machine. The
// drawing reuses the board's primitives (#103), in an SVG of its own.
import { useId, useMemo, useState } from "react";
import { Heatmap } from "@/player/primitives/Heatmap";
import { Plot } from "@/player/primitives/Plot";
import { FONT } from "@/player/primitives/style";
import type { ObjectState } from "@/shared/scene";
import {
  type HeatmapWidget,
  heatmapView,
  type PlotWidget,
  plotYRange,
  sampleCurve,
  snapToStep,
  startValues,
  type Widget,
  WIDGET_LIMITS,
} from "@/shared/widget";
import { formatTick } from "@/shared/viz";
import styles from "./Widget.module.css";

/** The drawings' viewBoxes. */
const PLOT_BOX = { w: 600, h: 300 } as const;
const HEAT_BOX = { w: 520, h: 360 } as const;

/** Re-mount (key) per step, so a new step's widget starts from its own values. */
export function WidgetPanel({ widget }: { widget: Widget }) {
  const [open, setOpen] = useState(true);
  const [resets, setResets] = useState(0);
  const titleId = useId();
  const bodyId = useId();
  return (
    <section
      className={styles.panel}
      data-testid="widget-panel"
      data-kind={widget.kind}
      data-open={open}
      // The board shrinks above the dock while the panel is open (Player.module.css).
      {...(open ? { "data-clear-of-dock": "" } : {})}
      aria-labelledby={titleId}
    >
      <header className={styles.head}>
        <h3 id={titleId} className={styles.title}>
          Try it yourself
        </h3>
        <span className={styles.spacer} />
        {open && (
          <button
            type="button"
            className={styles.button}
            onClick={() => setResets((n) => n + 1)}
          >
            Reset
          </button>
        )}
        <button
          type="button"
          className={styles.button}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide" : "Show"}
        </button>
      </header>
      {/* Hidden, not unmounted, so Show brings the learner's values back. */}
      <div id={bodyId} hidden={!open}>
        {widget.kind === "plot" ? (
          <PlotBody key={resets} widget={widget} />
        ) : (
          <HeatmapBody key={resets} widget={widget} />
        )}
      </div>
    </section>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  name,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  name: string;
}) {
  const id = useId();
  return (
    <div className={styles.slider} data-param={name}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      <output
        htmlFor={id}
        className={styles.value}
        data-testid={`value-${name}`}
      >
        {formatTick(value)}
      </output>
    </div>
  );
}

function PlotBody({ widget }: { widget: PlotWidget }) {
  const [values, setValues] = useState(() => startValues(widget));
  // The y axis is fixed from the starting values, so the curve moves, not the axes.
  const yRange = useMemo(() => plotYRange(widget), [widget]);
  // A huge but finite y (exp(70x)) is clipped anyway; held near the axes so the path stays drawable.
  const span = yRange[1] - yRange[0];
  const points = (sampleCurve(widget, values) ?? []).map(
    ([x, y]): [number, number] => [
      x,
      Math.min(yRange[1] + 10 * span, Math.max(yRange[0] - 10 * span, y)),
    ],
  );
  const state: ObjectState = {
    object: {
      kind: "plot",
      id: "widget_plot",
      x: 0,
      y: 0,
      w: PLOT_BOX.w,
      h: PLOT_BOX.h,
      xRange: widget.x,
      yRange,
      series: [{ points }],
      ...(widget.xLabel ? { xLabel: widget.xLabel } : {}),
      ...(widget.yLabel ? { yLabel: widget.yLabel } : {}),
    },
    visible: true,
    highlight: null,
  };
  const finite = points.filter(([, y]) => Number.isFinite(y)).length;
  return (
    <div className={styles.body}>
      <svg
        className={styles.drawing}
        viewBox={`0 0 ${PLOT_BOX.w} ${PLOT_BOX.h}`}
        role="img"
        aria-label={`Plot of ${widget.expr}`}
        fontFamily={FONT}
        data-testid="widget-drawing"
        data-finite-points={finite}
        data-first-y={
          finite ? String(points.find(([, y]) => Number.isFinite(y))![1]) : ""
        }
      >
        {state.object.kind === "plot" && (
          <Plot plot={state.object} state={state} active={[]} />
        )}
      </svg>
      <div className={styles.controls}>
        <p className={styles.expr}>
          <code>y = {widget.expr}</code>
        </p>
        {widget.params.map((p) => (
          <Slider
            key={p.name}
            name={p.name}
            label={p.label}
            min={p.min}
            max={p.max}
            step={p.step}
            value={values[p.name]}
            onChange={(v) => setValues((old) => ({ ...old, [p.name]: v }))}
          />
        ))}
      </div>
    </div>
  );
}

/** A cell's text the scores take: a number within ±maxScore (blank or "-" keeps the last). */
function isScore(text: string): boolean {
  const n = Number(text);
  return (
    text.trim() !== "" &&
    Number.isFinite(n) &&
    Math.abs(n) <= WIDGET_LIMITS.maxScore
  );
}

function HeatmapBody({ widget }: { widget: HeatmapWidget }) {
  const [scores, setScores] = useState(() => widget.values.map((r) => [...r]));
  // A cell being typed in keeps its text ("-", "1."), and the view uses its last number.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [temperature, setTemperature] = useState(
    widget.temperature && snapToStep(widget.temperature),
  );
  const view = heatmapView(widget, scores, temperature);
  const softmax = widget.transform === "softmax-rows";
  const nCols = widget.values[0].length;
  const rowName = (r: number) => widget.rowLabels?.[r] ?? `row ${r + 1}`;
  const colName = (c: number) => widget.colLabels?.[c] ?? `column ${c + 1}`;
  const state: ObjectState = {
    object: {
      kind: "heatmap",
      id: "widget_heatmap",
      x: 0,
      y: 0,
      w: HEAT_BOX.w,
      h: HEAT_BOX.h,
      values: view.map((r) => r.map((v) => Number(v.toFixed(2)))),
      showValues: true,
      ...(softmax ? { scale: { min: 0, max: 1 } } : {}),
      ...(widget.rowLabels ? { rowLabels: widget.rowLabels } : {}),
      ...(widget.colLabels ? { colLabels: widget.colLabels } : {}),
    },
    visible: true,
    highlight: null,
  };
  return (
    <div className={styles.body}>
      <svg
        className={styles.drawing}
        viewBox={`0 0 ${HEAT_BOX.w} ${HEAT_BOX.h}`}
        role="img"
        aria-label={
          softmax ? "Softmax of each row of the scores" : "The scores"
        }
        fontFamily={FONT}
        data-testid="widget-drawing"
      >
        {state.object.kind === "heatmap" && (
          <Heatmap heatmap={state.object} state={state} active={[]} />
        )}
      </svg>
      <div className={styles.controls}>
        <p className={styles.caption}>
          {softmax ? "Scores (each row goes through softmax)" : "Scores"}
        </p>
        <div
          className={styles.grid}
          style={{ gridTemplateColumns: `repeat(${nCols}, minmax(0, 1fr))` }}
          role="group"
          aria-label="Scores"
        >
          {scores.map((row, r) =>
            row.map((v, c) => {
              const key = `${r},${c}`;
              return (
                <input
                  key={key}
                  type="number"
                  step="any"
                  inputMode="decimal"
                  className={styles.cell}
                  data-cell={key}
                  aria-label={`Score, ${rowName(r)}, ${colName(c)}`}
                  value={drafts[key] ?? String(v)}
                  aria-invalid={
                    key in drafts && !isScore(drafts[key]) ? true : undefined
                  }
                  onChange={(e) => {
                    const text = e.currentTarget.value;
                    const n = Number(text);
                    setDrafts((d) => ({ ...d, [key]: text }));
                    if (isScore(text))
                      setScores((old) =>
                        old.map((rr, i) =>
                          i === r ? rr.map((cc, j) => (j === c ? n : cc)) : rr,
                        ),
                      );
                  }}
                  onBlur={() =>
                    setDrafts((d) => {
                      const rest = { ...d };
                      delete rest[key];
                      return rest;
                    })
                  }
                />
              );
            }),
          )}
        </div>
        {widget.temperature && temperature !== undefined && (
          <Slider
            name="temperature"
            label="Temperature"
            min={widget.temperature.min}
            max={widget.temperature.max}
            step={widget.temperature.step}
            value={temperature}
            onChange={setTemperature}
          />
        )}
      </div>
    </div>
  );
}

/** The tutor card's prompt line while a widget is on screen. */
export function WidgetPrompt({ prompt }: { prompt: string }) {
  return (
    <p className={styles.prompt} data-testid="widget-prompt">
      {prompt}
    </p>
  );
}
