# "Try it yourself" widgets: guidance for the step generator (#110)

For the step prompt (`lib/pipeline`, Jason's side) to adopt. The contract is `Widget` in
`shared/widget.ts`, on `Step.widget` (ARCHITECTURE.md §4). Both examples below are full
`Step`s, and `tests/unit/shared/widgetSnippet.test.ts` checks that they pass `validateStep`.

## When to add one

At most one per step, and only where playing with it teaches something the narration
can't: a parameter whose effect is easier to feel than to describe, or a calculation the
learner can poke at. Skip it for steps that are definitions, history or prose. Good fits:

- **plot**: a function of `x` with 1–4 parameters as sliders: a Gaussian's height and width,
  softmax/sigmoid temperature, a learning-rate schedule's decay, a positional encoding's
  frequency, ReLU vs leaky ReLU slope.
- **heatmap**: a small grid of numbers the learner edits (up to 8 × 8): attention scores
  through `softmax-rows` with a temperature slider, a similarity matrix, a tiny kernel.

The widget appears when the narration ends, with `prompt` on the tutor card. Write the
narration so it ends by inviting it ("Try it yourself: lower the temperature and watch the
weights sharpen."), and make `prompt` say what to change and what to look for.

## How to write them

- `prompt`: one line, at most 160 characters, starting "Try it yourself:".
- **plot** `expr`: a formula in `x` and the parameters. Allowed: numbers, `x`, the declared
  parameter names, `pi`, `e`, `+ - * / ^ ( )`, unary minus, and `sin cos tan exp log sqrt abs
  tanh min max` (`min`/`max` take two or more arguments). `^` is a power and is
  right-associative; `-x^2` means `-(x^2)`. Write `*` explicitly (`2 * x`, not `2x`). Nothing
  else: no other names, no `;`, no `.` outside numbers, no code. At most 200 characters.
- `x`: `[min, max]`. Give `y: [min, max]` too, so the axes don't depend on the starting curve:
  choose it to fit the curve across the sliders' whole range (points outside are clipped).
- `params`: 0–4 sliders `{ name, label, min, max, step, value }`. `name` is lower-case
  (`a`, `temp`, `k2`), not `x`, `pi`, `e` or a function name, and unique. `value` starts
  between `min` and `max`. `label` is what the learner reads ("temperature T").
- A point where the formula isn't finite (log of a negative, division by zero) is skipped and
  the curve breaks there; but the curve must be finite somewhere at the starting values.
- **heatmap** `values`: 1–8 rows × 1–8 columns of numbers, all rows the same length; optional
  `rowLabels` / `colLabels` (one per row / column, at most 24 characters). With
  `transform: "softmax-rows"`, each row is shown as softmax(row / temperature), and an
  optional `temperature` slider `{ min, max, step, value }` (min above 0) lets the learner
  change it. Without a transform, the grid shows the scores as they are.

## Example 1: attention weights with a temperature ("Attention Is All You Need")

```json
{
  "title": "Softmax turns scores into attention",
  "narration": "Each query scores every key, and [[soft]]softmax turns a row of scores into weights that sum to one. Dividing by a temperature first controls how sharp they are. Try it yourself: change a score, or the temperature, and watch the weights move.",
  "objects": [
    {
      "kind": "text",
      "id": "title",
      "x": 800,
      "y": 450,
      "text": "softmax(scores / T)",
      "size": "l"
    }
  ],
  "actions": [
    {
      "cue": "soft",
      "do": "highlight",
      "target": { "id": "title" },
      "durationMs": 400
    }
  ],
  "widget": {
    "kind": "heatmap",
    "prompt": "Try it yourself: raise one score, then lower the temperature to sharpen the weights.",
    "values": [
      [2.0, 1.0, 0.1, 0.5],
      [0.3, 2.5, 0.4, 1.1],
      [0.2, 1.9, 1.2, 0.1],
      [0.4, 0.6, 0.9, 1.5]
    ],
    "rowLabels": ["The", "animal", "was", "tired"],
    "colLabels": ["The", "animal", "was", "tired"],
    "transform": "softmax-rows",
    "temperature": { "min": 0.1, "max": 3, "step": 0.1, "value": 1 }
  }
}
```

## Example 2: a curve with sliders

```json
{
  "title": "A bell curve's two knobs",
  "narration": "A Gaussian has a [[height]]height and a width. Raising the height scales the whole curve, and a larger b squeezes it narrower. Try it yourself: move the two sliders.",
  "objects": [
    {
      "kind": "latex",
      "id": "eq",
      "x": 800,
      "y": 450,
      "tex": "y = a\\,e^{-b x^2}"
    }
  ],
  "actions": [
    {
      "cue": "height",
      "do": "highlight",
      "target": { "id": "eq" },
      "durationMs": 400
    }
  ],
  "widget": {
    "kind": "plot",
    "prompt": "Try it yourself: change a and b and watch the bell grow and narrow.",
    "expr": "a * exp(-b * x^2)",
    "x": [-3, 3],
    "y": [0, 3],
    "params": [
      {
        "name": "a",
        "label": "height a",
        "min": 0.5,
        "max": 2.5,
        "step": 0.1,
        "value": 1
      },
      {
        "name": "b",
        "label": "narrowness b",
        "min": 0.2,
        "max": 4,
        "step": 0.1,
        "value": 1
      }
    ],
    "xLabel": "x",
    "yLabel": "y"
  }
}
```

## Rejections (named, so the one retry can fix them)

| Problem | Error |
|---|---|
| A name in `expr` that isn't `x`, a parameter, `pi` or `e` | `widget expr: unknown name "y"` |
| `expr` doesn't parse | `widget expr: ...` (e.g. `expected ")", found the end`, `"sin" needs ( ) after it`, `expected an operator, found "x"`) |
| `expr` longer than 200 characters, or nested too deep (each bracket, call or unary minus counts; about 15 brackets) | `widget expr: longer than 200 characters` / `nested deeper than 32` |
| No finite value anywhere on `x` at the starting values | `widget expr: no finite value anywhere on x at the starting values` |
| A parameter named `x`, `pi`, `e` or a function, or two with one name | `widget param: reserved name "sin"` / `duplicate name "a"` |
| A slider with min >= max, or value outside min..max; step <= 0 | `widget.params.0: a slider needs min < max and min <= value <= max` |
| More than 4 params, an `x` / `y` with min >= max, a prompt over 160 characters | the schema error |
| A heatmap over 8 × 8, ragged, or labels that don't match | `widget.values: widget rows must all have the same length`, `widget.rowLabels: rowLabels needs one label per row (4)` |
| A temperature without `softmax-rows`, or at or below 0 | `widget.temperature: a temperature needs transform "softmax-rows"` / `temperature must be above 0` |
