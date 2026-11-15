// The "try it yourself" widgets the dev player's fake lesson ends step 1 with (issue #110):
// /dev/player?widget=plot or ?widget=heatmap.
import { Widget } from "@/shared/widget";

export const FAKE_WIDGETS = {
  plot: Widget.parse({
    kind: "plot",
    prompt: "Try it yourself: change the height and the width of the bell.",
    expr: "a * exp(-b * x^2)",
    x: [-3, 3],
    y: [0, 3],
    params: [
      { name: "a", label: "Height a", min: 0.5, max: 2.5, step: 0.1, value: 1 },
      {
        name: "b",
        label: "Narrowness b",
        min: 0.2,
        max: 4,
        step: 0.1,
        value: 1,
      },
    ],
    xLabel: "x",
    yLabel: "y",
  }),
  heatmap: Widget.parse({
    kind: "heatmap",
    prompt:
      "Try it yourself: edit a score, or turn the temperature down to sharpen the weights.",
    values: [
      [2, 1, 0.1],
      [0.5, 2.5, 0.3],
      [0.2, 1.8, 1.2],
    ],
    rowLabels: ["The", "cat", "sat"],
    colLabels: ["The", "cat", "sat"],
    transform: "softmax-rows",
    temperature: { min: 0.1, max: 3, step: 0.1, value: 1 },
  }),
} as const;
