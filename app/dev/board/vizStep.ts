// The heatmap and plot fixture step (issue #103), for /dev/board?scene=viz and the unit
// tests: attention weights revealed row by row, then a softmax curve drawing on along x.
import type { CueTimes } from "@/shared/lesson";
import { Step } from "@/shared/scene";

const TOKENS = ["The", "cat", "sat", "because", "it", "tired"];

/** Each row sums to 1: one query token's attention over the keys. */
const WEIGHTS = [
  [0.7, 0.1, 0.05, 0.05, 0.05, 0.05],
  [0.1, 0.6, 0.15, 0.05, 0.05, 0.05],
  [0.05, 0.4, 0.4, 0.05, 0.05, 0.05],
  [0.05, 0.1, 0.25, 0.4, 0.1, 0.1],
  [0.05, 0.62, 0.08, 0.05, 0.15, 0.05],
  [0.05, 0.3, 0.05, 0.05, 0.35, 0.2],
];

/** softmax([z, 0])[0] = 1 / (1 + e^(-z/T)), sampled every 0.5 over [-6, 6]. */
const softmaxCurve = (temperature: number) =>
  Array.from({ length: 25 }, (_, i) => {
    const z = -6 + i * 0.5;
    return [z, Number((1 / (1 + Math.exp(-z / temperature))).toFixed(3))];
  });

export const VIZ_STEP: Step = Step.parse({
  title: "Attention weights as a heatmap",
  narration:
    "Each [[row0]]row is one word's attention. The [[row1]]next row is the cat's own. " +
    "Fill in [[rest]]the others, and see [[peak]]it look back at the cat. " +
    "Softmax turns a [[curve]]score into a weight, and a [[temp]]higher temperature " +
    "flattens it, with a score of [[point]]zero giving one half.",
  objects: [
    {
      kind: "text",
      id: "title",
      x: 800,
      y: 60,
      text: "Who attends to whom",
      size: "l",
    },
    {
      kind: "heatmap",
      id: "attn",
      x: 120,
      y: 170,
      w: 640,
      h: 560,
      values: WEIGHTS,
      rowLabels: TOKENS,
      colLabels: TOKENS,
      showValues: true,
      cellsHidden: true,
      label: "Attention weights",
    },
    {
      kind: "plot",
      id: "soft",
      x: 880,
      y: 170,
      w: 620,
      h: 560,
      xRange: [-6, 6],
      yRange: [0, 1],
      series: [
        { points: softmaxCurve(1), label: "T = 1", hidden: true },
        { points: softmaxCurve(2), label: "T = 2", hidden: true },
      ],
      xLabel: "score z",
      yLabel: "weight",
    },
  ],
  actions: [
    {
      cue: "row0",
      do: "show",
      target: { id: "attn", row: 0 },
      durationMs: 600,
    },
    {
      cue: "row1",
      do: "show",
      target: { id: "attn", row: 1 },
      durationMs: 600,
    },
    ...[2, 3, 4, 5].map((row) => ({
      cue: "rest",
      do: "show",
      target: { id: "attn", row },
      durationMs: 600,
    })),
    {
      cue: "peak",
      do: "highlight",
      target: { id: "attn", row: 4, col: 1 },
      color: "warn",
      durationMs: 400,
    },
    {
      cue: "curve",
      do: "show",
      target: { id: "soft", row: 0 },
      durationMs: 1500,
    },
    {
      cue: "temp",
      do: "show",
      target: { id: "soft", row: 1 },
      durationMs: 1500,
    },
    {
      cue: "point",
      do: "highlight",
      target: { id: "soft", row: 0, col: 12 },
      durationMs: 400,
    },
  ],
});

/** Cue times (ms) for the dev page and the tests. */
export const VIZ_CUE_TIMES = {
  row0: 500,
  row1: 1500,
  rest: 2500,
  peak: 3500,
  curve: 4500,
  temp: 6500,
  point: 8500,
} as const satisfies CueTimes;
