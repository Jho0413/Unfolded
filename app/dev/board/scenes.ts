// Scenes for the dev-only /dev/board page (renderer tests and screenshots).
import demoM1 from "@/lib/fakes/fixtures/demo-m1.step.json";
import type { CueTimes } from "@/shared/lesson";
import {
  type BoardObject,
  type BoardState,
  type CuedAction,
  Step,
} from "@/shared/scene";
import { sceneAt, type TimedAction, timeline } from "@/player/sceneAt";

/**
 * A fixed BoardState covering every matrix, text, latex and arrow feature:
 * row, column and cell highlights in both colours, a whole-matrix highlight,
 * text sizes, a highlighted text, a hidden object, a show and a hide in
 * progress, a copy of a row that carries its source cells' highlight, a
 * highlighted formula, tex KaTeX can't parse, tex that tries to link out, an
 * arrow into the moved row's copy, and a highlighted point-to-point arrow.
 */
export const FIXED: BoardState = {
  objects: [
    {
      object: {
        kind: "text",
        id: "title",
        x: 800,
        y: 70,
        text: "Fixed board",
        size: "l",
      },
      visible: true,
      highlight: null,
    },
    {
      object: {
        kind: "matrix",
        id: "m",
        x: 160,
        y: 200,
        rows: [
          ["1", "2", "3"],
          ["4", "5", "6"],
          ["7", "8", "9"],
        ],
        label: "M",
      },
      visible: true,
      highlight: null,
      // Row 0 accent, column 2 below it warn, cell (2, 0) warn.
      cellHighlight: [
        ["accent", "accent", "accent"],
        [null, null, "warn"],
        ["warn", null, "warn"],
      ],
    },
    {
      object: {
        kind: "matrix",
        id: "v",
        x: 520,
        y: 248,
        rows: [["x"], ["y"]],
        label: "v",
      },
      visible: true,
      highlight: null,
      // A whole-matrix highlight sets every cell (ARCHITECTURE.md 5.3).
      cellHighlight: [["accent"], ["accent"]],
    },
    {
      object: {
        kind: "text",
        id: "small",
        x: 900,
        y: 220,
        text: "small",
        size: "s",
      },
      visible: true,
      highlight: null,
    },
    {
      object: { kind: "text", id: "medium", x: 1100, y: 220, text: "medium" },
      visible: true,
      highlight: "accent",
    },
    {
      object: {
        kind: "text",
        id: "large",
        x: 1340,
        y: 220,
        text: "large",
        size: "l",
      },
      visible: true,
      highlight: "warn",
    },
    {
      object: {
        kind: "text",
        id: "gone",
        x: 900,
        y: 340,
        text: "hidden",
        hidden: true,
      },
      visible: false,
      highlight: null,
    },
    {
      object: {
        kind: "text",
        id: "fading",
        x: 1100,
        y: 340,
        text: "fading out",
      },
      visible: true,
      highlight: null,
    },
    {
      object: {
        kind: "text",
        id: "appearing",
        x: 1340,
        y: 340,
        text: "fading in",
      },
      visible: true,
      highlight: null,
    },
    {
      object: {
        kind: "latex",
        id: "eq",
        x: 330,
        y: 520,
        tex: "\\frac{QK^\\top}{\\sqrt{d_k}}",
      },
      visible: true,
      highlight: "accent",
    },
    {
      // Unparseable: KaTeX shows the source in its error colour (throwOnError: false).
      object: { kind: "latex", id: "bad", x: 330, y: 680, tex: "\\frac{1}{" },
      visible: true,
      highlight: null,
    },
    {
      // trust: false, so no link is made.
      object: {
        kind: "latex",
        id: "unsafe",
        x: 330,
        y: 800,
        tex: "\\href{javascript:alert(1)}{x}",
      },
      visible: true,
      highlight: null,
    },
    {
      // Row 1 of m has moved, so this end is the copy's centre (900, 560).
      object: {
        kind: "arrow",
        id: "to_copy",
        from: { id: "eq" },
        to: { id: "m", row: 1 },
        label: "copy",
      },
      visible: true,
      highlight: null,
    },
    {
      object: {
        kind: "arrow",
        id: "pt",
        from: { x: 1200, y: 520 },
        to: { x: 1450, y: 760 },
        label: "points",
      },
      visible: true,
      highlight: "warn",
    },
  ],
  copies: [{ source: { id: "m", row: 1 }, x: 900, y: 560, visible: true }],
  active: [
    {
      action: { do: "hide", target: { id: "fading" }, durationMs: 400 },
      progress: 0.5,
    },
    {
      action: { do: "show", target: { id: "appearing" }, durationMs: 400 },
      progress: 0.25,
    },
  ],
};

const m1 = Step.parse(demoM1);

/** Cue times for demo-m1 on the dev page (ms); the real ones come from TTS. */
const M1_CUE_TIMES: CueTimes = {
  row: 1000,
  col: 2000,
  slide: 3000, // two moves, 800 ms
  pair1: 4500,
  pair2: 5000,
  add: 5500,
  total: 6000,
  drop: 6500, // 600 ms
  done: 7500, // copies fade out over 300 ms
};

const m1Timed = timeline(m1.actions, M1_CUE_TIMES);

/** demo-m1, plus a warn highlight on cell (0, 1) of `a` after the slide. */
const lateHighlight: TimedAction[] = [
  ...m1Timed.filter((t) => t.startMs <= M1_CUE_TIMES.slide),
  {
    action: {
      do: "highlight",
      target: { id: "a", row: 0, col: 1 },
      color: "warn",
      durationMs: 300,
    },
    startMs: 4000,
    durationMs: 300,
  },
];

/**
 * Arrows following what they point at: `fa` runs from a latex formula that
 * moves, `qa` from a matrix row whose copy slides, and a hidden formula and
 * its hidden arrow `ga` fade in before `fa` is highlighted.
 */
const ARROW_OBJECTS: BoardObject[] = [
  { kind: "latex", id: "f", x: 300, y: 300, tex: "f(x) = x^2" },
  { kind: "text", id: "out", x: 1300, y: 300, text: "output" },
  {
    kind: "arrow",
    id: "fa",
    from: { id: "f" },
    to: { id: "out" },
    label: "maps to",
  },
  {
    kind: "matrix",
    id: "q",
    x: 200,
    y: 600,
    rows: [
      ["1", "2"],
      ["3", "4"],
    ],
    label: "Q",
  },
  {
    kind: "arrow",
    id: "qa",
    from: { id: "q", row: 0 },
    to: { x: 900, y: 450 },
  },
  {
    kind: "latex",
    id: "g",
    x: 1100,
    y: 750,
    tex: "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}",
    hidden: true,
  },
  {
    kind: "arrow",
    id: "ga",
    from: { id: "g" },
    to: { id: "out" },
    label: "sum",
    hidden: true,
  },
];

const ARROW_TIMES = {
  move: 1000, // f to (300, 150), 1000 ms
  slide: 2000, // q row 0 to (1000, 600), 1000 ms
  show: 3000, // g and its arrow ga fade in, 400 ms
  highlight: 3500, // fa warn and g accent, 400 ms
} as const satisfies CueTimes;

const arrowActions: CuedAction[] = [
  {
    cue: "move",
    do: "move",
    target: { id: "f" },
    to: { x: 300, y: 150 },
    durationMs: 1000,
  },
  {
    cue: "slide",
    do: "move",
    target: { id: "q", row: 0 },
    to: { x: 1000, y: 600 },
    durationMs: 1000,
  },
  { cue: "show", do: "show", target: { id: "g" }, durationMs: 400 },
  { cue: "show", do: "show", target: { id: "ga" }, durationMs: 400 },
  {
    cue: "highlight",
    do: "highlight",
    target: { id: "fa" },
    color: "warn",
    durationMs: 400,
  },
  { cue: "highlight", do: "highlight", target: { id: "g" }, durationMs: 400 },
];

const arrowTimed = timeline(arrowActions, ARROW_TIMES);

export const SCENES = ["fixed", "m1", "m1-late-highlight", "arrows"] as const;
export type SceneName = (typeof SCENES)[number];

/** The times a timed scene's page links to, by name (ms). */
export const SCENE_TIMES: Record<Exclude<SceneName, "fixed">, CueTimes> = {
  m1: M1_CUE_TIMES,
  "m1-late-highlight": M1_CUE_TIMES,
  arrows: ARROW_TIMES,
};

export function isScene(name: string): name is SceneName {
  return (SCENES as readonly string[]).includes(name);
}

/** The board for a scene at `tMs` (ignored by the fixed scene). */
export function sceneState(name: SceneName, tMs: number): BoardState {
  switch (name) {
    case "fixed":
      return FIXED;
    case "m1":
      return sceneAt(m1.objects, m1Timed, tMs);
    case "m1-late-highlight":
      return sceneAt(m1.objects, lateHighlight, tMs);
    case "arrows":
      return sceneAt(ARROW_OBJECTS, arrowTimed, tMs);
  }
}
