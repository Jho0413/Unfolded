// QA A4: the board shows the part of the canvas a step uses (player/viewport.ts), so a small
// drawing fills the pane. 16:9, padded, inside the canvas, zoomed at most MAX_ZOOM, and the
// same for the whole step (hidden objects and where copies move to count from the start).
import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import demoM1 from "@/lib/fakes/fixtures/demo-m1.step.json";
import { sceneAt } from "@/player/sceneAt";
import {
  contentBox,
  cropView,
  FULL_VIEW,
  MAX_ZOOM,
  stepView,
  VIEW_PAD,
} from "@/player/viewport";
import { Whiteboard } from "@/player/Whiteboard";
import { BoardState, CANVAS, type SceneObject, Step } from "@/shared/scene";

const text = (id: string, x: number, y: number): SceneObject => ({
  kind: "text",
  id,
  x,
  y,
  text: "hello",
});

describe("cropView", () => {
  it("an empty board, or a drawing that spans the canvas, shows the whole canvas", () => {
    expect(cropView(undefined)).toEqual(FULL_VIEW);
    expect(cropView({ x0: 10, y0: 10, x1: 1590, y1: 890 })).toEqual(FULL_VIEW);
  });

  it("a small drawing is zoomed at most MAX_ZOOM, centred on it", () => {
    const v = cropView({ x0: 700, y0: 400, x1: 900, y1: 500 });
    expect(v.w).toBe(CANVAS.w / MAX_ZOOM);
    expect(v.h).toBe(CANVAS.h / MAX_ZOOM);
    expect(v.x + v.w / 2).toBe(800);
    expect(v.y + v.h / 2).toBe(450);
  });

  it("a drawing near an edge stays inside the canvas", () => {
    const v = cropView({ x0: 0, y0: 0, x1: 300, y1: 100 });
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
  });

  it("any drawing: the view is 16:9, inside the canvas, and holds the drawing with its padding", () => {
    const coord = (max: number) => fc.integer({ min: 0, max });
    fc.assert(
      fc.property(
        coord(1600),
        coord(900),
        coord(1600),
        coord(900),
        (a, b, c, d) => {
          const box = {
            x0: Math.min(a, c),
            y0: Math.min(b, d),
            x1: Math.max(a, c),
            y1: Math.max(b, d),
          };
          const v = cropView(box);
          expect(v.w / v.h).toBeCloseTo(CANVAS.w / CANVAS.h, 2);
          expect(v.x).toBeGreaterThanOrEqual(0);
          expect(v.y).toBeGreaterThanOrEqual(0);
          expect(v.x + v.w).toBeLessThanOrEqual(CANVAS.w + 0.1);
          expect(v.y + v.h).toBeLessThanOrEqual(CANVAS.h + 0.1);
          if (v !== FULL_VIEW) {
            expect(v.x).toBeLessThanOrEqual(
              Math.max(0, box.x0 - VIEW_PAD) + 0.1,
            );
            expect(v.x + v.w).toBeGreaterThanOrEqual(
              Math.min(CANVAS.w, box.x1 + VIEW_PAD) - 0.1,
            );
            expect(v.y).toBeLessThanOrEqual(
              Math.max(0, box.y0 - VIEW_PAD) + 0.1,
            );
            expect(v.y + v.h).toBeGreaterThanOrEqual(
              Math.min(CANVAS.h, box.y1 + VIEW_PAD) - 0.1,
            );
          }
        },
      ),
    );
  });
});

describe("contentBox", () => {
  it("counts hidden objects, heatmaps and plots, and arrow ends on points", () => {
    const box = contentBox([
      { ...text("a", 400, 300), hidden: true },
      {
        kind: "plot",
        id: "p",
        x: 900,
        y: 200,
        w: 300,
        h: 200,
        xRange: [0, 1],
        yRange: [0, 1],
        series: [{ points: [[0, 0]] }],
      },
      { kind: "arrow", id: "r", from: { id: "a" }, to: { x: 1300, y: 600 } },
    ])!;
    expect(box.x0).toBeLessThan(400);
    expect(box.x1).toBe(1300);
    expect(box.y0).toBe(200);
    expect(box.y1).toBe(600);
  });

  it("counts where a move to a point takes a matrix row's copy", () => {
    const m: SceneObject = {
      kind: "matrix",
      id: "m",
      x: 400,
      y: 300,
      rows: [
        ["1", "2"],
        ["3", "4"],
      ],
    };
    const box = contentBox(
      [m],
      [{ do: "move", target: { id: "m", row: 0 }, to: { x: 1200, y: 700 } }],
    )!;
    expect(box.x1).toBe(1200 + 64);
    expect(box.y1).toBe(700 + 24);
  });
});

describe("the M1 demo step", () => {
  const step = Step.parse(demoM1);
  it("is shown cropped, holding every object at every moment of the step", () => {
    const v = stepView(step);
    expect(v.w).toBeLessThanOrEqual(CANVAS.w);
    const box = contentBox(step.objects, step.actions)!;
    expect(v.x).toBeLessThanOrEqual(box.x0);
    expect(v.x + v.w).toBeGreaterThanOrEqual(box.x1);
  });

  it("the Whiteboard draws with the view as its viewBox", () => {
    const v = stepView(step);
    const html = renderToStaticMarkup(
      <Whiteboard
        state={BoardState.parse(sceneAt(step.objects, [], 0))}
        view={v}
      />,
    );
    expect(html).toContain(`viewBox="${v.x} ${v.y} ${v.w} ${v.h}"`);
    expect(
      renderToStaticMarkup(
        <Whiteboard state={BoardState.parse(sceneAt(step.objects, [], 0))} />,
      ),
    ).toContain('viewBox="0 0 1600 900"');
  });
});
