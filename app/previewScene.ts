// The sample lesson the upload page's preview draws while idle (app/LessonPreview.tsx): one
// small step, played through the real board (player/sceneAt.ts and player/Whiteboard.tsx), so
// the preview is the product. A test holds it to the step rules (shared/validate.ts).
import type { CueTimes } from "@/shared/lesson";
import type { Step } from "@/shared/scene";

/** Scores for three answers; the board shows their softmax at T = 1, then at T = 2. */
const SCORES = [2, 0.8, -0.2];

function softmax(scores: readonly number[], t: number): number[] {
  const exps = scores.map((z) => Math.exp(z / t));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

const at = (t: number) => softmax(SCORES, t).map((p) => p.toFixed(2));

/** The temperatures the plot samples, 0.5 to 3. */
const TEMPS = Array.from({ length: 11 }, (_, i) => 0.5 + i * 0.25);
const curve = (answer: number) =>
  TEMPS.map((t) => [t, Number(softmax(SCORES, t)[answer].toFixed(3))]);

/** The outline's title and rows beside the drawing. */
export const SAMPLE_LESSON = {
  title: "Temperature scaling",
  steps: [
    "Scaled scores",
    "Softmax over a row",
    "Temperature T",
    "Same argmax",
  ],
} as const;

export const SAMPLE_STEP: Step = {
  title: "Temperature T",
  narration:
    "Here are the [[row]]probabilities for three answers. The [[top]]first one wins. Dividing every score by [[soften]]T softens the softmax, [[curve]]flattening the curve [[curve2]]without changing which answer wins.",
  objects: [
    {
      kind: "latex",
      id: "formula",
      x: 600,
      y: 290,
      tex: "\\mathrm{softmax}(z / T)",
    },
    {
      kind: "matrix",
      id: "p",
      x: 504,
      y: 360,
      rows: [at(1)],
      hidden: true,
    },
    {
      kind: "text",
      id: "t1",
      x: 600,
      y: 470,
      text: "T = 1",
      size: "s",
      hidden: true,
    },
    {
      kind: "text",
      id: "t2",
      x: 600,
      y: 470,
      text: "T = 2",
      size: "s",
      hidden: true,
    },
    {
      kind: "plot",
      id: "plot",
      x: 760,
      y: 270,
      w: 400,
      h: 330,
      xRange: [0.5, 3],
      yRange: [0, 1],
      xLabel: "T",
      yLabel: "p",
      series: [
        { points: curve(0), label: "first", hidden: true },
        { points: curve(1), label: "second", hidden: true },
      ],
    },
  ],
  actions: [
    { cue: "row", do: "show", target: { id: "p" }, durationMs: 400 },
    { cue: "row", do: "show", target: { id: "t1" }, durationMs: 400 },
    {
      cue: "top",
      do: "highlight",
      target: { id: "p", row: 0, col: 0 },
      color: "accent",
      durationMs: 400,
    },
    { cue: "soften", do: "hide", target: { id: "t1" }, durationMs: 300 },
    { cue: "soften", do: "show", target: { id: "t2" }, durationMs: 300 },
    ...at(2).map((value, col) => ({
      cue: "soften",
      do: "write" as const,
      target: { id: "p", row: 0, col },
      value,
      durationMs: 400,
    })),
    {
      cue: "curve",
      do: "show",
      target: { id: "plot", row: 0 },
      durationMs: 1200,
    },
    {
      cue: "curve2",
      do: "show",
      target: { id: "plot", row: 1 },
      durationMs: 1200,
    },
  ],
};

/** When each cue's word would be spoken (ms): the drawing takes about five seconds. */
export const SAMPLE_CUE_TIMES: CueTimes = {
  row: 400,
  top: 1300,
  soften: 2200,
  curve: 3000,
  curve2: 3900,
};

/** The tutor card's line while the sample draws. */
export const SAMPLE_LINE =
  "Dividing every score by T softens the softmax without changing which answer wins.";
