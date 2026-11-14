// Scenes for the dev-only /dev/board page (renderer tests and screenshots).
import demoM1 from "@/lib/fakes/fixtures/demo-m1.step.json";
import type { CueTimes } from "@/shared/lesson";
import { type BoardState, Step } from "@/shared/scene";
import { sceneAt, type TimedAction, timeline } from "@/player/sceneAt";

/**
 * A fixed BoardState covering every matrix and text feature: row, column and
 * cell highlights in both colours, a whole-matrix highlight, text sizes, a
 * highlighted text, a hidden object, a show and a hide in progress, and a
 * copy of a row that carries its source cells' highlight.
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

/** The hand-written demo-m1 step (lib/fakes/fixtures), also the fake step on /dev/player. */
export const m1 = Step.parse(demoM1);

/** Cue times for demo-m1 on the dev page (ms); the real ones come from TTS. */
export const M1_CUE_TIMES: CueTimes = {
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

export const SCENES = ["fixed", "m1", "m1-late-highlight"] as const;
export type SceneName = (typeof SCENES)[number];

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
  }
}
