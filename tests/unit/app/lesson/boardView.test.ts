// app/lesson/[lessonId]/boardView.ts: one test per row of the Answer view table
// (ARCHITECTURE.md section 5.6), driving the real Ask layer (qa/askBoard.ts, qa/askSession.ts),
// client tools (qa/tools.ts) and player machine the lesson page uses.
import { describe, expect, it, vi } from "vitest";
import { afterLeavingAsk, boardView } from "@/app/lesson/[lessonId]/boardView";
import { afterAskEvent } from "@/player/controls";
import { type PlayerState, transition } from "@/player/machine";
import {
  addAction,
  addSketch,
  type AskLayer,
  askScene,
  EMPTY_LAYER,
} from "@/qa/askBoard";
import { createAskSession } from "@/qa/askSession";
import { sketchFailedUpdate } from "@/qa/drawScene";
import { ANSWER_SHOWING, createClientTools } from "@/qa/tools";
import { SKETCH_FAILED } from "@/shared/lesson";
import type { BoardObject, Sketch } from "@/shared/scene";

const lessonObject: BoardObject = {
  kind: "text",
  id: "lesson_t",
  x: 400,
  y: 300,
  text: "the lesson",
};
const frozen = { objects: [lessonObject], timed: [], pausedT: 1000 };
const sketch = (id: string): Sketch => ({
  objects: [{ kind: "text", id, x: 800, y: 110, text: "an answer" }],
  actions: [],
});
const ids = (layer: AskLayer) =>
  askScene(frozen, layer, 0).objects.map((s) => s.object.id);

const explaining = { kind: "playing", step: 1 } as const;
const asking: PlayerState = { kind: "asking", from: explaining };
const paused: PlayerState = { kind: "paused", step: 1 };
const CTX = { stepCount: 3 };

describe("the Answer view table", () => {
  it("Lesson (asking, no sketch), draw_scene succeeds: Answer view, the drawing only, the lesson hidden", () => {
    expect(boardView(true, EMPTY_LAYER)).toBe("lesson");
    const layer = addSketch(EMPTY_LAYER, sketch("first"), 0, true);
    expect(boardView(true, layer)).toBe("answer");
    expect(ids(layer)).toEqual(["first"]);
  });

  it("Lesson, an answer in words only (highlights work as today): stays on the lesson", () => {
    const layer = addAction(
      EMPTY_LAYER,
      { do: "highlight", target: { id: "lesson_t" }, durationMs: 400 },
      0,
    );
    expect(boardView(true, layer)).toBe("lesson");
    expect(ids(layer)).toEqual(["lesson_t"]);
  });

  it("Answer, draw_scene again (a follow-up): the new drawing replaces the old", () => {
    const first = addSketch(EMPTY_LAYER, sketch("first"), 0, true);
    const second = addSketch(first, sketch("second"), 500, true);
    expect(boardView(true, second)).toBe("answer");
    expect(ids(second)).toEqual(["second"]);
  });

  it("Answer, closeAsk then resume (Got it, carry on): the lesson, narrating again", () => {
    const closed = transition(asking, { type: "closeAsk" }, CTX);
    expect(closed.state).toEqual(paused);
    expect(afterLeavingAsk("carryOn", "answer", explaining, paused)).toEqual({
      type: "resume",
    });
    // Leaving asking is what removes the Answer view: one source of truth.
    const layer = addSketch(EMPTY_LAYER, sketch("first"), 0, true);
    expect(boardView(false, layer)).toBe("lesson");
  });

  it("Answer, the Back to step N chip: the lesson, paused where they were", () => {
    expect(afterLeavingAsk("back", "answer", explaining, paused)).toBeNull();
  });

  it("Answer, Escape (or the agent ending the session): the lesson, paused where they were", () => {
    expect(afterLeavingAsk("dismiss", "answer", explaining, paused)).toBeNull();
    // On the lesson, a dismissal still goes back to how it was before Ask (section 5.6).
    expect(afterLeavingAsk("dismiss", "lesson", explaining, paused)).toEqual(
      afterAskEvent("dismiss", explaining, paused),
    );
  });

  it("Answer, go_to_step / next / previous (through closeAsk first): the lesson at that step", () => {
    const jumped = transition(asking, { type: "goToStep", n: 2 }, CTX).state;
    const closed = transition(jumped, { type: "closeAsk" }, CTX);
    expect(closed.state).toMatchObject({ kind: "loading", step: 2 });
    expect(afterLeavingAsk("carryOn", "answer", explaining, closed.state)).toBe(
      null,
    );
    const layer = addSketch(EMPTY_LAYER, sketch("first"), 0, true);
    expect(boardView(closed.state.kind === "asking", layer)).toBe("lesson");
  });

  it(`Answer, the highlight tool: a no-op, the agent is told "${ANSWER_SHOWING}"`, async () => {
    const session = createAskSession(() => 0);
    session.open();
    session.addSketch(sketch("first"), true);
    const highlight = vi.fn();
    const tools = createClientTools({
      board: session.board,
      highlight,
      send: (event) => transition(asking, event, CTX),
      isAsking: session.isAsking,
      askId: session.askId,
      drawSketch: () => {},
      showNotice: () => {},
      answerShowing: () =>
        boardView(session.isAsking(), session.layer()) === "answer",
    });
    expect(await tools.highlight?.({ target_id: "first" })).toBe(
      ANSWER_SHOWING,
    );
    expect(highlight).not.toHaveBeenCalled();
  });

  it("Answer (or Lesson), the sketch fails: stays where it was, Couldn't draw that, the agent is told", async () => {
    for (const drawnBefore of [true, false]) {
      const session = createAskSession(() => 0);
      session.open();
      if (drawnBefore) session.addSketch(sketch("first"), true);
      const before = boardView(session.isAsking(), session.layer());
      const showNotice = vi.fn();
      const tools = createClientTools({
        board: session.board,
        highlight: session.addAction,
        send: (event) => transition(asking, event, CTX),
        isAsking: session.isAsking,
        askId: session.askId,
        drawSketch: (s) => session.addSketch(s, true),
        showNotice,
        fetch: async () =>
          Response.json({ error: SKETCH_FAILED }, { status: 502 }),
      });
      // The tool waits, so the agent hears the failure as its result.
      const result = await tools.draw_scene?.({
        description: "a follow-up",
        fresh: true,
      });
      expect(showNotice).toHaveBeenCalledWith(SKETCH_FAILED);
      expect(result).toBe(sketchFailedUpdate("a follow-up"));
      expect(boardView(session.isAsking(), session.layer())).toBe(before);
      expect(session.layer().objects.map((o) => o.id)).toEqual(
        drawnBefore ? ["first"] : [],
      );
    }
  });

  it("any, Ask closes while a sketch is in flight: the sketch is dropped", () => {
    const session = createAskSession(() => 0);
    session.open();
    session.close();
    session.addSketch(sketch("late"), true);
    expect(boardView(session.isAsking(), session.layer())).toBe("lesson");
    expect(session.layer().objects).toEqual([]);
  });
});
