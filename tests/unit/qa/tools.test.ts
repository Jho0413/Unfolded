// The Q&A client tool handlers (ARCHITECTURE.md section 8, ROADMAP Q4).
import { describe, expect, it, vi } from "vitest";
import {
  initialState,
  type PlayerEvent,
  type PlayerState,
  transition,
} from "@/player/machine";
import { createClientTools, type HighlightAction } from "@/qa/tools";
import type { BoardObject, BoardState } from "@/shared/scene";

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
const label: BoardObject = {
  kind: "text",
  id: "label",
  x: 400,
  y: 100,
  text: "Q",
};
const later: BoardObject = {
  kind: "text",
  id: "later",
  x: 400,
  y: 300,
  text: "K",
};

const board: BoardState = {
  objects: [
    { object: q, visible: true, highlight: null },
    { object: label, visible: true, highlight: null },
    { object: later, visible: false, highlight: null },
  ],
  copies: [],
  active: [],
};

const CTX = { stepCount: 3 };

/** The machine, run the way the lesson page runs it. */
function harness(start: PlayerState) {
  let state = start;
  const highlights: HighlightAction[] = [];
  const send = (event: PlayerEvent) => {
    const result = transition(state, event, CTX);
    state = result.state;
    return result;
  };
  const tools = createClientTools({
    board: () => board,
    highlight: (a) => highlights.push(a),
    send,
  });
  return { tools, highlights, send, state: () => state };
}

const asking: PlayerState = {
  kind: "asking",
  from: { kind: "playing", step: 0 },
};

describe("highlight", () => {
  it("highlights a whole object: ok", async () => {
    const h = harness(asking);
    expect(await h.tools.highlight?.({ target_id: "label" })).toBe("ok");
    expect(h.highlights).toEqual([
      { do: "highlight", target: { id: "label" }, durationMs: 400 },
    ]);
  });

  it("highlights a matrix row, column or cell: ok", async () => {
    const h = harness(asking);
    expect(await h.tools.highlight?.({ target_id: "q", row: 0 })).toBe("ok");
    expect(await h.tools.highlight?.({ target_id: "q", col: 1 })).toBe("ok");
    expect(await h.tools.highlight?.({ target_id: "q", row: 1, col: 1 })).toBe(
      "ok",
    );
    expect(h.highlights.map((a) => a.target)).toEqual([
      { id: "q", row: 0 },
      { id: "q", col: 1 },
      { id: "q", row: 1, col: 1 },
    ]);
  });

  it('rejects an unknown id: unknown object "x"', async () => {
    const h = harness(asking);
    expect(await h.tools.highlight?.({ target_id: "x" })).toBe(
      'unknown object "x"',
    );
    expect(h.highlights).toEqual([]);
  });

  it("rejects a hidden object as not on the board", async () => {
    const h = harness(asking);
    expect(await h.tools.highlight?.({ target_id: "later" })).toBe(
      'unknown object "later"',
    );
  });

  it("rejects a row or column outside the matrix, or on a non-matrix", async () => {
    const h = harness(asking);
    const outOfRange = await h.tools.highlight?.({ target_id: "q", row: 2 });
    const onText = await h.tools.highlight?.({ target_id: "label", col: 0 });
    expect(outOfRange).toMatch(/"q"/);
    expect(onText).toMatch(/"label"/);
    expect(outOfRange).not.toBe("ok");
    expect(onText).not.toBe("ok");
    expect(h.highlights).toEqual([]);
  });
});

describe("go_to_step", () => {
  it("is 1-based: step 3 remembers step index 2 while asking, ok", async () => {
    const h = harness(asking);
    expect(await h.tools.go_to_step?.({ step: 3 })).toBe("ok");
    expect(h.state()).toEqual({ ...asking, goTo: 2 });
  });

  it("rejects a step outside the plan: no step n, state unchanged", async () => {
    const h = harness(asking);
    expect(await h.tools.go_to_step?.({ step: 4 })).toBe("no step 4");
    expect(h.state()).toEqual(asking);
  });

  it("during asking, loads the step paused once Ask closes", async () => {
    const h = harness(initialState().state);
    h.send({ type: "stepReady", i: 0 });
    expect(h.state().kind).toBe("playing");
    h.send({ type: "ask" });
    expect(await h.tools.go_to_step?.({ step: 2 })).toBe("ok");
    expect(h.state().kind).toBe("asking");
    const closed = h.send({ type: "closeAsk" });
    expect(closed.state).toEqual({ kind: "loading", step: 1, autoplay: false });
    expect(closed.outcome === "changed" && closed.effects).toContainEqual({
      type: "loadStep",
      step: 1,
    });
  });
});

describe("simplify_upcoming", () => {
  it("is a stub that returns nothing", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const h = harness(asking);
    expect(
      await h.tools.simplify_upcoming?.({ reason: "too fast" }),
    ).toBeUndefined();
    info.mockRestore();
  });
});

describe("draw_scene", () => {
  it("isn't handled until Q5", () => {
    expect(harness(asking).tools.draw_scene).toBeUndefined();
  });
});
