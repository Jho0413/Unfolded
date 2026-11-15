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

  it("shows a drawn answer on its own clock (#105), and close throws it away", () => {
    const { session, advance } = setup();
    const listener = vi.fn();
    session.subscribe(listener);
    let answerMs = 0;
    session.setAnswerClock(() => answerMs);
    session.open();
    advance(500);
    session.showAnswer(
      {
        narration: "Look at [[row]]the row.",
        objects: [note],
        actions: [
          {
            do: "highlight",
            target: { id: "note" },
            cue: "row",
            durationMs: 0,
          },
        ],
      },
      { row: 100 },
    );
    const highlight = () => session.board().objects[0].highlight;
    expect(session.board().objects.map((s) => s.object.id)).toEqual(["note"]);
    expect(highlight()).toBeNull();
    // Time since Ask opened doesn't move it; its narration's clock does.
    advance(5000);
    expect(highlight()).toBeNull();
    answerMs = 100;
    expect(highlight()).toBe("accent");
    session.close();
    expect(session.board().objects.map((s) => s.object.id)).toEqual(["q"]);
    expect(listener).toHaveBeenCalledTimes(3); // open, answer, close
  });

  it("every open and close changes the version, even with nothing drawn", () => {
    const { session } = setup();
    const v0 = session.version();
    session.open();
    const v1 = session.version();
    session.close();
    expect(v1).not.toBe(v0);
    expect(session.version()).not.toBe(v1);
  });

  it("keeps the frozen board while asking (a step arriving shows after close)", () => {
    const { session } = setup();
    session.open();
    session.setFrozen(frozenBoard({ objects: [note], timed: [] }, 0));
    expect(session.board().objects.map((s) => s.object.id)).toEqual(["q"]);
    session.close();
    session.setFrozen(frozenBoard({ objects: [note], timed: [] }, 0));
    expect(session.board().objects.map((s) => s.object.id)).toEqual(["note"]);
  });

  it("ignores drawings while not asking", () => {
    const { session } = setup();
    session.addAction({ do: "highlight", target: { id: "q" }, durationMs: 0 });
    session.showAnswer({ narration: "Hi.", objects: [note], actions: [] }, {});
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
