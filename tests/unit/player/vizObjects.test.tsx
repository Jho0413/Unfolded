// Heatmap and plot (issue #103) through sceneAt and the whiteboard: reveals and draw-ons are
// pure functions of t (t = 0, mid, end, and a seek back gives the same board), and what they
// render to. The browser checks are in tests/e2e/board.spec.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VIZ_CUE_TIMES, VIZ_STEP } from "@/app/dev/board/vizStep";
import { Whiteboard } from "@/player/Whiteboard";
import { Heatmap } from "@/player/primitives/Heatmap";
import { Plot } from "@/player/primitives/Plot";
import { resolveAnchor, sceneAt, timeline } from "@/player/sceneAt";
import {
  drawnPoints,
  heatColor,
  lengthShareAt,
  revealOf,
  revealOrder,
} from "@/player/primitives/vizStyle";
import { BoardState, type SceneObject, type Step } from "@/shared/scene";
import {
  heatmapCellCentre,
  heatmapLayout,
  niceTicks,
  plotPoint,
} from "@/shared/viz";
import { targetBox } from "@/player/primitives/arrowGeometry";

const timed = timeline(VIZ_STEP.actions, VIZ_CUE_TIMES);
const at = (t: number) => sceneAt(VIZ_STEP.objects, timed, t);
const state = (board: BoardState, id: string) =>
  board.objects.find((s) => s.object.id === id)!;
const T = VIZ_CUE_TIMES;

describe("sceneAt: heatmap reveals", () => {
  it("t = 0: every cell is hidden, the heatmap itself is visible", () => {
    const h = state(at(0), "attn");
    expect(h.visible).toBe(true);
    expect(h.cellVisible!.flat().every((v) => !v)).toBe(true);
    expect(at(0).active).toEqual([]);
  });

  it("mid-reveal: row 0 is revealed and its show is active at half progress, with its cells", () => {
    const board = at(T.row0 + 300);
    expect(state(board, "attn").cellVisible![0].every(Boolean)).toBe(true);
    expect(state(board, "attn").cellVisible![1].some(Boolean)).toBe(false);
    expect(board.active).toHaveLength(1);
    expect(board.active[0].progress).toBe(0.5);
    expect(board.active[0].cells).toHaveLength(6);
    expect(revealOf(board.active, "attn", 0, 3)).toEqual({
      draw: 0.5,
      fade: 1,
      by: { id: "attn", row: 0 },
    });
    // Cell 3 of 6 in the row fills in after the first ones (motion.ts staggerIn).
    expect(revealOrder({ id: "attn", row: 0 }, 0, 3, 6, 6)).toEqual({
      i: 3,
      n: 6,
    });
    expect(revealOf(board.active, "attn", 1, 3)).toEqual({ draw: 1, fade: 1 });
  });

  it("end: every row is revealed, the peak cell is highlighted warn, nothing is active", () => {
    const board = at(T.peak + 600);
    const h = state(board, "attn");
    expect(h.cellVisible!.flat().every(Boolean)).toBe(true);
    expect(h.cellHighlight![4][1]).toBe("warn");
    expect(h.cellHighlight!.flat().filter(Boolean)).toHaveLength(1);
    expect(board.active).toEqual([]);
  });

  it("a show of a row already revealed changes nothing, so it isn't active", () => {
    const again = timeline(
      [
        ...VIZ_STEP.actions,
        {
          cue: "again",
          do: "show",
          target: { id: "attn", row: 0 },
          durationMs: 600,
        },
      ],
      { ...VIZ_CUE_TIMES, again: 10_000 },
    );
    const board = sceneAt(VIZ_STEP.objects, again, 10_100);
    expect(board.active).toEqual([]);
  });

  it("a hide of a row conceals it when it ends, fading its cells meanwhile", () => {
    const hidden = timeline(
      [
        ...VIZ_STEP.actions,
        {
          cue: "gone",
          do: "hide",
          target: { id: "attn", row: 2 },
          durationMs: 400,
        },
      ],
      { ...VIZ_CUE_TIMES, gone: 10_000 },
    );
    const mid = sceneAt(VIZ_STEP.objects, hidden, 10_100);
    expect(state(mid, "attn").cellVisible![2].every(Boolean)).toBe(true);
    expect(revealOf(mid.active, "attn", 2, 0)).toEqual({ draw: 1, fade: 0.75 });
    const end = sceneAt(VIZ_STEP.objects, hidden, 10_400);
    expect(state(end, "attn").cellVisible![2].some(Boolean)).toBe(false);
    expect(state(end, "attn").cellVisible![3].every(Boolean)).toBe(true);
  });
});

describe("sceneAt: plot draw-on", () => {
  it("t = 0: both series are undrawn", () => {
    const p = state(at(0), "soft");
    expect(p.cellVisible!.map((row) => row.every((v) => !v))).toEqual([
      true,
      true,
    ]);
  });

  it("mid: series 0 draws on with the show's progress, series 1 waits", () => {
    const board = at(T.curve + 750);
    const p = state(board, "soft");
    expect(p.cellVisible![0].every(Boolean)).toBe(true);
    expect(p.cellVisible![1].some(Boolean)).toBe(false);
    const { draw } = revealOf(board.active, "soft", 0, 0);
    expect(draw).toBe(0.5);
  });

  it("end: both drawn, point 12 of series 0 highlighted", () => {
    const board = at(20_000);
    const p = state(board, "soft");
    expect(p.cellVisible!.flat().every(Boolean)).toBe(true);
    expect(p.cellHighlight![0][12]).toBe("accent");
    expect(board.active).toEqual([]);
  });

  it("seek: any time gives the same board as playing up to it, forwards or back", () => {
    for (const t of [0, T.row0 + 300, T.rest + 100, T.curve + 750, 20_000]) {
      const direct = at(t);
      at(20_000); // played past it first
      expect(at(t)).toStrictEqual(direct);
      expect(BoardState.safeParse(direct).success).toBe(true);
    }
  });
});

describe("sceneAt: hides, whole-object highlights, and matrices unchanged", () => {
  const cued = (extra: Step["actions"], times: Record<string, number>) =>
    timeline([...VIZ_STEP.actions, ...extra], { ...VIZ_CUE_TIMES, ...times });

  it("a plot series hide fades it out, then leaves it undrawn", () => {
    const t = cued(
      [
        {
          cue: "off",
          do: "hide",
          target: { id: "soft", row: 1 },
          durationMs: 400,
        },
      ],
      { off: 10_000 },
    );
    const mid = sceneAt(VIZ_STEP.objects, t, 10_100);
    expect(state(mid, "soft").cellVisible![1].every(Boolean)).toBe(true);
    expect(revealOf(mid.active, "soft", 1, 0).fade).toBe(0.75);
    const end = sceneAt(VIZ_STEP.objects, t, 10_400);
    expect(state(end, "soft").cellVisible![1].some(Boolean)).toBe(false);
    expect(state(end, "soft").cellVisible![0].every(Boolean)).toBe(true);
  });

  it("a whole heatmap or plot highlight sets every cell", () => {
    const t = cued(
      [
        { cue: "all", do: "highlight", target: { id: "attn" }, durationMs: 0 },
        {
          cue: "all",
          do: "highlight",
          target: { id: "soft" },
          color: "warn",
          durationMs: 0,
        },
      ],
      { all: 10_000 },
    );
    const board = sceneAt(VIZ_STEP.objects, t, 10_000);
    const attn = state(board, "attn").cellHighlight!.flat();
    // The whole-object highlight repaints the earlier warn peak too, as on a matrix.
    expect(attn.every((h) => h === "accent")).toBe(true);
    expect(
      state(board, "soft")
        .cellHighlight!.flat()
        .every((h) => h === "warn"),
    ).toBe(true);
  });

  it("a matrix part's hide (its copy) carries no cells", () => {
    const objects: SceneObject[] = [
      { kind: "matrix", id: "m", x: 100, y: 100, rows: [["1", "2"]] },
    ];
    const board = sceneAt(
      objects,
      [
        {
          action: {
            do: "move",
            target: { id: "m", row: 0 },
            to: { x: 600, y: 400 },
            durationMs: 0,
          },
          startMs: 0,
          durationMs: 0,
        },
        {
          action: { do: "hide", target: { id: "m", row: 0 }, durationMs: 400 },
          startMs: 100,
          durationMs: 400,
        },
      ],
      300,
    );
    expect(board.active).toHaveLength(1);
    expect(board.active[0]).not.toHaveProperty("cells");
  });
});

describe("arrows to a heatmap or plot stop at its box", () => {
  const board = at(20_000);
  const [, attn] = VIZ_STEP.objects;
  if (attn.kind !== "heatmap") throw new Error();
  const { cellW, cellH } = heatmapLayout(attn);
  it("a whole heatmap or plot is its box", () => {
    expect(targetBox(board, { id: "attn" })).toEqual({ w: 640, h: 560 });
    expect(targetBox(board, { id: "soft" })).toEqual({ w: 620, h: 560 });
  });
  it("a heatmap cell or row is its cells", () => {
    expect(targetBox(board, { id: "attn", row: 1, col: 2 })).toEqual({
      w: cellW,
      h: cellH,
    });
    expect(targetBox(board, { id: "attn", row: 1 })).toEqual({
      w: 6 * cellW,
      h: cellH,
    });
  });
  it("a plot point is exact", () => {
    expect(targetBox(board, { id: "soft", row: 0, col: 3 })).toBeUndefined();
  });
});

describe("draw-on geometry", () => {
  const line = [
    [0, 0],
    [1, 1],
    [2, 0],
  ];
  it("cuts a line along x, interpolating the last segment", () => {
    expect(drawnPoints(line, 0, true)).toEqual([[0, 0]]);
    expect(drawnPoints(line, 0.25, true)).toEqual([
      [0, 0],
      [0.5, 0.5],
    ]);
    expect(drawnPoints(line, 0.75, true)).toEqual([
      [0, 0],
      [1, 1],
      [1.5, 0.5],
    ]);
    expect(drawnPoints(line, 1, true)).toEqual(line);
  });
  it("the share of a path's length left of a cut", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 6, y: 4 },
    ];
    expect(lengthShareAt(pts, 0)).toBe(0);
    expect(lengthShareAt(pts, 3)).toBe(0.625);
    expect(lengthShareAt(pts, 4.5)).toBe(0.8125);
    expect(lengthShareAt(pts, 6)).toBe(1);
  });
  it("points style keeps whole points only", () => {
    expect(drawnPoints(line, 0.6, false)).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
});

describe("anchors and scales", () => {
  it("an arrow end on a heatmap cell or a plot point resolves to where it is drawn", () => {
    const [, attn, soft] = VIZ_STEP.objects;
    if (attn.kind !== "heatmap" || soft.kind !== "plot") throw new Error();
    const board = at(0);
    expect(resolveAnchor(board, { id: "attn", row: 4, col: 1 })).toEqual(
      heatmapCellCentre(attn, 4, 1),
    );
    expect(resolveAnchor(board, { id: "soft", row: 0, col: 12 })).toEqual(
      plotPoint(soft, 0, 12),
    );
    expect(resolveAnchor(board, { id: "soft" })).toEqual({
      x: soft.x + soft.w / 2,
      y: soft.y + soft.h / 2,
    });
  });

  it("a moved heatmap moves its cells' anchors with it", () => {
    const objects: SceneObject[] = [VIZ_STEP.objects[1]];
    const board = sceneAt(
      objects,
      [
        {
          action: {
            do: "move",
            target: { id: "attn" },
            to: { x: 800, y: 450 },
            durationMs: 400,
          },
          startMs: 0,
          durationMs: 400,
        },
      ],
      400,
    );
    const moved = state(board, "attn").object;
    expect(moved.kind === "heatmap" && moved.x + moved.w / 2).toBe(800);
  });

  it("heat colours run between the theme's stops", () => {
    expect(heatColor(0)).toBe("var(--wb-heat-0)");
    expect(heatColor(1)).toBe("var(--wb-heat-4)");
    expect(heatColor(0.5)).toBe("var(--wb-heat-2)");
    expect(heatColor(0.125)).toBe(
      "color-mix(in oklab, var(--wb-heat-1) 50%, var(--wb-heat-0))",
    );
  });

  it("ticks are round and about five", () => {
    expect(niceTicks(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(-6, 6)).toEqual([-6, -4, -2, 0, 2, 4, 6]);
  });

  it("ticks always end, even where a step is below the values' precision", () => {
    expect(niceTicks(1e16, 1e16 + 2).length).toBeLessThanOrEqual(50);
  });
});

describe("renderer", () => {
  const html = (t: number) =>
    renderToStaticMarkup(<Whiteboard state={at(t)} />);
  /** One object rendered alone, for a focused snapshot. */
  const objectHtml = (t: number, id: string) => {
    const board = at(t);
    const s = state(board, id);
    const o = s.object;
    return renderToStaticMarkup(
      <svg>
        {o.kind === "heatmap" && (
          <Heatmap heatmap={o} state={s} active={board.active} />
        )}
        {o.kind === "plot" && <Plot plot={o} state={s} active={board.active} />}
      </svg>,
    );
  };

  it("draws both objects with their kinds", () => {
    const out = html(0);
    expect(out).toContain('data-kind="heatmap"');
    expect(out).toContain('data-kind="plot"');
  });

  it("heatmap at t = 0, mid-reveal and the end", () => {
    expect(objectHtml(0, "attn")).toMatchSnapshot("heatmap t=0");
    expect(objectHtml(T.row0 + 300, "attn")).toMatchSnapshot("heatmap mid");
    expect(objectHtml(20_000, "attn")).toMatchSnapshot("heatmap end");
  });

  it("plot at t = 0, mid-draw and the end", () => {
    expect(objectHtml(0, "soft")).toMatchSnapshot("plot t=0");
    expect(objectHtml(T.curve + 750, "soft")).toMatchSnapshot("plot mid");
    expect(objectHtml(20_000, "soft")).toMatchSnapshot("plot end");
  });
});
