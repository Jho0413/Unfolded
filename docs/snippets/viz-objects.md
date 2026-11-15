# Heatmaps and plots: guidance for the step generator (#103)

For the step prompt (`lib/pipeline`, Jason's side) to adopt. The contract is
`HeatmapObject` and `PlotObject` in `shared/scene.ts` (ARCHITECTURE.md §4). Both examples
below are full `Step`s, and `tests/unit/shared/vizSnippet.test.ts` checks that they pass
`validateStep`.

**Not on the wire yet.** `WireStep` and `WireSketch` embed `BoardObject`, which doesn't
include these kinds: the API has no grammar headroom for more object kinds (S3, #27). To use
them, put `SceneObject` (or a subset) in the wire schema, and run a real request with the
bigger schema before merging (the size-guard test in `outputFormat.test.ts` moves with it).

## When to use them

- **heatmap**: a grid of numbers where the **pattern** matters more than any one value:
  attention weights, a similarity or confusion matrix, a kernel, a correlation table, a
  probability table. Prefer a `matrix` when the learner must read and work with the exact
  entries (a matrix product by hand), or when entries are symbols, not numbers.
- **plot**: a **function or relationship** over a range: an activation (softmax, ReLU,
  sigmoid), a loss curve, a learning-rate schedule, a positional-encoding sine, a
  before/after comparison of up to four curves. You give sampled points, not code or
  formulas. Use a `latex` object next to it for the formula.

## How to write them

- **Box.** `x, y, w, h` is the whole object, labels, ticks and axis titles included. At least
  120 × 120; give a heatmap about 60–100 px per cell, and a plot at least 500 × 360. A
  heatmap's `label` is drawn **above** the box (about 40 px), like a matrix's.
- **Heatmap values.** Numbers only, rectangular, at most 12 × 12. Round to 2 decimals.
  Set `showValues: true` when the grid is 6 × 6 or smaller; above that, colour alone reads
  better. Set `scale` when values have natural ends (probabilities: `{ "min": 0, "max": 1 }`)
  or two heatmaps should share colours; otherwise it is the data's min and max.
- **Labels.** `rowLabels` / `colLabels` (one per row / column, at most 24 characters): for
  attention, the tokens (rows are queries, columns are keys).
- **Plot points.** 15–60 `[x, y]` points per series are plenty for a smooth curve (at most
  200). A `line` series' x values must never decrease. Use `style: "points"` for a scatter.
  Choose `xRange` and `yRange` to frame the data; points outside are clipped.
- **Up to 4 series**, each with a short `label` when there is more than one (it goes in the
  legend).

## Actions and targets

| You want | Action |
|---|---|
| Fill a heatmap row by row as you talk | `cellsHidden: true`, then `show` on `{ "id": "attn", "row": 0 }`, `{ "row": 1 }`, ... (or `col`, or a single cell `{ "row", "col" }`) |
| Point at one weight | `highlight` on `{ "id": "attn", "row": 2, "col": 1 }` (`color: "warn"` for a second colour) |
| Highlight a query's whole row | `highlight` on `{ "id": "attn", "row": 2 }` |
| Draw a curve as you describe it | series `hidden: true`, then `show` on `{ "id": "plot", "row": 0 }` (series 0) with `durationMs` 1000–2000: it draws on left to right |
| Point at a point on a curve | `highlight` on `{ "id": "plot", "row": 0, "col": 12 }` (series 0, point 12) |
| Emphasise a whole curve | `highlight` on `{ "id": "plot", "row": 1 }` |
| An arrow to a cell or a point | `arrow` with `to: { "id": "attn", "row": 2, "col": 1 }` or `{ "id": "plot", "row": 0, "col": 12 }` |

Rejected: `write` on either (`can't write to "x"`), `move` on a part (`can't move "x"`; move
the whole object), `show` on a single plot point (show draws a whole series), and any row or
column past the grid or the series (`target out of range "x"`).

## Example 1: attention weights ("Attention Is All You Need")

```json
{
  "title": "Who attends to whom",
  "narration": "Each row is one word's attention over the sentence. [[r0]]The looks mostly at itself, [[r1]]animal too, and [[r2]]it puts most of its weight on [[peak]]animal: that is how the model resolves the pronoun. [[r3]]Tired spreads its attention more.",
  "objects": [
    {
      "kind": "heatmap",
      "id": "attn",
      "x": 300,
      "y": 180,
      "w": 560,
      "h": 480,
      "values": [
        [0.7, 0.2, 0.05, 0.05],
        [0.15, 0.7, 0.1, 0.05],
        [0.05, 0.75, 0.1, 0.1],
        [0.05, 0.45, 0.3, 0.2]
      ],
      "rowLabels": ["The", "animal", "it", "tired"],
      "colLabels": ["The", "animal", "it", "tired"],
      "scale": { "min": 0, "max": 1 },
      "showValues": true,
      "cellsHidden": true,
      "label": "Attention weights"
    },
    {
      "kind": "latex",
      "id": "eq",
      "x": 1200,
      "y": 420,
      "tex": "\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}\\left(\\frac{QK^\\top}{\\sqrt{d_k}}\\right)V"
    }
  ],
  "actions": [
    { "cue": "r0", "do": "show", "target": { "id": "attn", "row": 0 }, "durationMs": 500 },
    { "cue": "r1", "do": "show", "target": { "id": "attn", "row": 1 }, "durationMs": 500 },
    { "cue": "r2", "do": "show", "target": { "id": "attn", "row": 2 }, "durationMs": 500 },
    { "cue": "peak", "do": "highlight", "target": { "id": "attn", "row": 2, "col": 1 }, "color": "warn", "durationMs": 400 },
    { "cue": "r3", "do": "show", "target": { "id": "attn", "row": 3 }, "durationMs": 500 }
  ]
}
```

## Example 2: a softmax curve

```json
{
  "title": "Softmax turns scores into weights",
  "narration": "Take one score z against a rival scored zero. As z [[draw]]grows, its weight rises smoothly from zero to one, and an equal score of [[half]]zero gives exactly one half.",
  "objects": [
    {
      "kind": "plot",
      "id": "soft",
      "x": 400,
      "y": 160,
      "w": 800,
      "h": 560,
      "xRange": [-6, 6],
      "yRange": [0, 1],
      "series": [
        {
          "points": [
            [-6, 0.002], [-5, 0.007], [-4, 0.018], [-3, 0.047], [-2, 0.119],
            [-1, 0.269], [0, 0.5], [1, 0.731], [2, 0.881], [3, 0.953],
            [4, 0.982], [5, 0.993], [6, 0.998]
          ],
          "label": "softmax([z, 0])₁",
          "hidden": true
        }
      ],
      "xLabel": "score z",
      "yLabel": "weight"
    }
  ],
  "actions": [
    { "cue": "draw", "do": "show", "target": { "id": "soft", "row": 0 }, "durationMs": 1500 },
    { "cue": "half", "do": "highlight", "target": { "id": "soft", "row": 0, "col": 6 }, "durationMs": 400 }
  ]
}
```

## Limits

| | Limit |
|---|---|
| Heatmap size | 1..12 rows × 1..12 columns, all rows the same length |
| Heatmap values | finite numbers |
| `rowLabels` / `colLabels` | exactly one per row / column, 1..24 characters each |
| `scale` | `min < max` |
| Plot series | 1..4 |
| Points per series | 2..200, each `[x, y]` (two finite numbers) |
| Line series | x never decreases (`style: "points"` may be in any order) |
| `xRange` / `yRange` | `[min, max]` with `min < max` |
| Box | `w, h >= 120`, inside the 1600 × 900 canvas |
