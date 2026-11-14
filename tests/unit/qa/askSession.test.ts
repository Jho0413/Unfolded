// The Ask session store (ARCHITECTURE.md section 8).
import { describe, expect, it, vi } from "vitest";
import { createAskSession, frozenBoard } from "@/qa/askSession";
import type { BoardObject } from "@/shared/scene";

const q: BoardObject = {
  kind: "matrix",
  id: "q",
  x: 100,
  y: 100,
  rows: [["1", "2"]],
};
const note = { kind: "text" as const, id: "note", x: 600, y: 400, text: "hi" };

function setup() {
  let t = 1000;
  const session = createAskSession(() => t);
  session.setFrozen(frozenBoard({ objects: [q], timed: [] }, 0));
  return { session, advance: (ms: number) => (t += ms) };
}

describe("createAskSession", () => {
  it("open starts a new session: new askId, empty layer", () => {
    const { session } = setup();
    expect(session.isAsking()).toBe(false);
    session.open();
    expect(session.isAsking()).toBe(true);
    expect(session.askId()).toBe(1);
    session.close();
    session.open();
    expect(session.askId()).toBe(2);
  });

  it("draws sketches timed from when Ask opened, and close throws them away", () => {
    const { session, advance } = setup();
    const listener = vi.fn();
    session.subscribe(listener);
    session.open();
    advance(500);
    session.addSketch(
      {
        objects: [note],
        actions: [
          {
            do: "highlight",
            target: { id: "q", row: 0 },
            atMs: 100,
            durationMs: 0,
          },
        ],
      },
      false,
    );
    const row = () => session.board().objects[0].cellHighlight?.[0];
    expect(session.board().objects.map((s) => s.object.id)).toEqual([
      "q",
      "note",
    ]);
    expect(row()).toEqual([null, null]);
    advance(100);
    expect(row()).toEqual(["accent", "accent"]);
    session.close();
    expect(session.board().objects.map((s) => s.object.id)).toEqual(["q"]);
    expect(listener).toHaveBeenCalledTimes(3); // open, sketch, close
  });

  it("ignores drawings while not asking", () => {
    const { session } = setup();
    session.addAction({ do: "highlight", target: { id: "q" }, durationMs: 0 });
    session.addSketch({ objects: [note], actions: [] }, false);
    expect(session.layer().timed).toEqual([]);
    expect(session.layer().objects).toEqual([]);
  });
});

describe("frozenBoard", () => {
  it("is the step at tMs, or an empty board with no step", () => {
    expect(frozenBoard(null, 500)).toEqual({
      objects: [],
      timed: [],
      pausedT: 0,
    });
    expect(frozenBoard({ objects: [q], timed: [] }, 500).pausedT).toBe(500);
  });
});
