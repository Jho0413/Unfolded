// The board during Ask (ARCHITECTURE.md sections 5.3 and 8).
import { describe, expect, it } from "vitest";
import { addAction, addSketch, askScene, EMPTY_LAYER } from "@/qa/askBoard";
import type { BoardObject, Sketch } from "@/shared/scene";

const q: BoardObject = {
  kind: "matrix",
  id: "q",
  x: 100,
  y: 100,
  rows: [
    ["1", "2"],
    ["3", "4"],
  ],
};
const frozen = { objects: [q], timed: [], pausedT: 3000 };
const sketch: Sketch = {
  objects: [{ kind: "text", id: "note", x: 600, y: 400, text: "hi" }],
  actions: [
    {
      do: "highlight",
      target: { id: "q", row: 0 },
      atMs: 500,
      durationMs: 400,
    },
  ],
};

const rowHighlight = (b: ReturnType<typeof askScene>) =>
  b.objects.find((s) => s.object.id === "q")?.cellHighlight?.[0];

describe("askScene", () => {
  it("with nothing drawn, is the frozen board", () => {
    const b = askScene(frozen, EMPTY_LAYER, 10_000);
    expect(b.objects.map((s) => s.object.id)).toEqual(["q"]);
    expect(rowHighlight(b)).toEqual([null, null]);
  });

  it("draws a sketch on top, its actions timed from arrival plus atMs", () => {
    const layer = addSketch(EMPTY_LAYER, sketch, 1000, false);
    expect(
      askScene(frozen, layer, 1000).objects.map((s) => s.object.id),
    ).toEqual(["q", "note"]);
    expect(rowHighlight(askScene(frozen, layer, 1499))).toEqual([null, null]);
    expect(rowHighlight(askScene(frozen, layer, 1500))).toEqual([
      "accent",
      "accent",
    ]);
  });

  it("a highlight tool call takes effect when it arrives", () => {
    const layer = addAction(
      EMPTY_LAYER,
      { do: "highlight", target: { id: "q", col: 1 }, durationMs: 400 },
      200,
    );
    const col = (t: number) =>
      askScene(frozen, layer, t).objects[0].cellHighlight?.map((r) => r[1]);
    expect(col(199)).toEqual([null, null]);
    expect(col(200)).toEqual(["accent", "accent"]);
  });

  it("a fresh sketch leaves out the lesson board and earlier drawings", () => {
    const fresh: Sketch = {
      objects: [{ kind: "text", id: "box", x: 50, y: 50, text: "new" }],
      actions: [],
    };
    const layer = addSketch(
      addSketch(EMPTY_LAYER, sketch, 0, false),
      fresh,
      100,
      true,
    );
    expect(layer.fresh).toBe(true);
    expect(
      askScene(frozen, layer, 200).objects.map((s) => s.object.id),
    ).toEqual(["box"]);
    // Later sketches build on the fresh board.
    const later = addSketch(layer, { objects: [], actions: [] }, 300, false);
    expect(later.fresh).toBe(true);
  });

  it("keeps the lesson actions that started by pausedT, not later ones", () => {
    const timed = [
      {
        action: { do: "hide" as const, target: { id: "q" }, durationMs: 0 },
        startMs: 5000,
        durationMs: 0,
      },
    ];
    const b = askScene({ ...frozen, timed }, EMPTY_LAYER, 10_000);
    expect(b.objects[0].visible).toBe(true);
  });
});
