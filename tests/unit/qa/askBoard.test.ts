// The board during Ask (ARCHITECTURE.md sections 5.3 and 8).
import { describe, expect, it } from "vitest";
import { addAction, answerLayer, askScene, EMPTY_LAYER } from "@/qa/askBoard";
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
/** A narrated answer (#105): its note shows on the cue "note", 500 ms into its narration. */
const sketch: Sketch = {
  narration: "Look at [[note]]this note.",
  objects: [
    { kind: "text", id: "note", x: 600, y: 400, text: "hi", hidden: true },
  ],
  actions: [{ do: "show", target: { id: "note" }, cue: "note", durationMs: 0 }],
};
const CUES = { note: 500 };

const rowHighlight = (b: ReturnType<typeof askScene>) =>
  b.objects.find((s) => s.object.id === "q")?.cellHighlight?.[0];

describe("askScene", () => {
  it("with nothing drawn, is the frozen board", () => {
    const b = askScene(frozen, EMPTY_LAYER, 10_000, 0);
    expect(b.objects.map((s) => s.object.id)).toEqual(["q"]);
    expect(rowHighlight(b)).toEqual([null, null]);
  });

  it("a drawn answer replaces the board, its actions on their cues on the answer's own clock", () => {
    const layer = answerLayer(sketch, CUES);
    expect(layer.fresh).toBe(true);
    const visible = (answerMs: number, sinceOpen = 0) =>
      askScene(frozen, layer, sinceOpen, answerMs).objects.map((s) => [
        s.object.id,
        s.visible,
      ]);
    // Only the answer: the lesson board is left out.
    expect(visible(0)).toEqual([["note", false]]);
    expect(visible(499)).toEqual([["note", false]]);
    expect(visible(500)).toEqual([["note", true]]);
    // Its clock is its narration's, not the time since Ask opened.
    expect(visible(0, 10_000)).toEqual([["note", false]]);
    // Past the end (Infinity): the whole drawing.
    expect(visible(Infinity)).toEqual([["note", true]]);
  });

  it("an answer's action whose cue has no time never fires (as in a step)", () => {
    const layer = answerLayer(sketch, {});
    expect(layer.timed).toEqual([]);
  });

  it("a highlight tool call takes effect when it arrives", () => {
    const layer = addAction(
      EMPTY_LAYER,
      { do: "highlight", target: { id: "q", col: 1 }, durationMs: 400 },
      200,
    );
    const col = (t: number) =>
      askScene(frozen, layer, t, 0).objects[0].cellHighlight?.map((r) => r[1]);
    expect(col(199)).toEqual([null, null]);
    expect(col(200)).toEqual(["accent", "accent"]);
  });

  it("a drawn answer replaces earlier highlights (always a fresh board)", () => {
    const highlighted = addAction(
      EMPTY_LAYER,
      { do: "highlight", target: { id: "q" }, durationMs: 0 },
      0,
    );
    expect(highlighted.timed).toHaveLength(1);
    const layer = answerLayer(sketch, CUES);
    expect(layer.objects.map((o) => o.id)).toEqual(["note"]);
    expect(layer.timed.map((t) => t.startMs)).toEqual([500]);
  });

  it("keeps the lesson actions that started by pausedT, not later ones", () => {
    const timed = [
      {
        action: { do: "hide" as const, target: { id: "q" }, durationMs: 0 },
        startMs: 5000,
        durationMs: 0,
      },
    ];
    const b = askScene({ ...frozen, timed }, EMPTY_LAYER, 10_000, 0);
    expect(b.objects[0].visible).toBe(true);
  });
});
