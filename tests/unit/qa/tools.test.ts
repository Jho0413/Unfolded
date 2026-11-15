// The Q&A client tool handlers (ARCHITECTURE.md section 8, ROADMAP Q4).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  initialState,
  type PlayerEvent,
  type PlayerState,
  transition,
} from "@/player/machine";
import {
  ANSWER_SHOWING,
  ASK_CLOSED,
  BACK_WHERE_STOPPED,
  createClientTools,
  NO_PAPER_VIEWER,
  type HighlightAction,
} from "@/qa/tools";
import type { BoardObject, BoardState } from "@/shared/scene";
import { CLIENT_TOOL_NAMES, CLIENT_TOOLS } from "@/shared/tools";
import { errors } from "@/shared/validate";

type AgentToolConfig = {
  type: string;
  name: (typeof CLIENT_TOOL_NAMES)[number];
  expects_response: boolean;
  parameters: {
    required?: string[];
    properties: Record<string, { type: string; description?: string }>;
  };
};

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
function harness(
  start: PlayerState,
  extra: Partial<Parameters<typeof createClientTools>[0]> = {},
) {
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
    isAsking: () => state.kind === "asking",
    askId: () => 1,
    lessonId: "lesson-1",
    playAnswer: async () => ({ kind: "shown" }),
    showNotice: () => {},
    fetch: vi.fn(() => new Promise<Response>(() => {})),
    ...extra,
  });
  return { tools, highlights, send, state: () => state };
}

const asking: PlayerState = {
  kind: "asking",
  from: { kind: "playing", step: 0 },
};

describe("highlight", () => {
  it(`while the Answer view is up: a no-op, "${ANSWER_SHOWING}"`, async () => {
    const h = harness(asking, { answerShowing: () => true });
    expect(await h.tools.highlight?.({ target_id: "label" })).toBe(
      ANSWER_SHOWING,
    );
    expect(h.highlights).toEqual([]);
  });

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
    expect(await h.tools.highlight?.({ target_id: "q", row: 2 })).toBe(
      errors.targetOutOfRange("q"),
    );
    expect(await h.tools.highlight?.({ target_id: "label", col: 0 })).toBe(
      errors.targetOutOfRange("label"),
    );
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

describe("go_to_step: the step the lesson stopped on (a real case, #90)", () => {
  it("goes back where it stopped (as the Back to step N chip), not a restart", async () => {
    const backToLesson = vi.fn();
    const h = harness(asking, { stoppedStep: () => 0, backToLesson });
    expect(await h.tools.go_to_step?.({ step: 1 })).toBe(BACK_WHERE_STOPPED);
    expect(backToLesson).toHaveBeenCalledOnce();
    expect(h.state()).toEqual(asking); // no goToStep: the step isn't loaded again
  });

  it("another step still jumps there", async () => {
    const backToLesson = vi.fn();
    const h = harness(asking, { stoppedStep: () => 0, backToLesson });
    expect(await h.tools.go_to_step?.({ step: 2 })).toBe("ok");
    expect(backToLesson).not.toHaveBeenCalled();
    expect(h.state()).toEqual({ ...asking, goTo: 1 });
  });
});

describe("a tool call that lands after Ask closed", () => {
  const paused: PlayerState = { kind: "paused", step: 0 };

  it("highlight: Ask is closed, nothing drawn", async () => {
    const h = harness(paused);
    expect(await h.tools.highlight?.({ target_id: "q" })).toBe(ASK_CLOSED);
    expect(h.highlights).toEqual([]);
  });

  it("go_to_step: Ask is closed, the step doesn't change", async () => {
    const h = harness(paused);
    expect(await h.tools.go_to_step?.({ step: 2 })).toBe(ASK_CLOSED);
    expect(h.state()).toEqual(paused);
  });
});

describe("highlight_paper (issue #98)", () => {
  it("passes the quote and page to the paper and returns its answer", async () => {
    const highlightPaper = vi.fn(() => "ok: highlighted on page 2");
    const h = harness(asking, { highlightPaper });
    expect(
      await h.tools.highlight_paper?.({
        quote: "a row times a column",
        page: 2,
      }),
    ).toBe("ok: highlighted on page 2");
    expect(highlightPaper).toHaveBeenCalledWith("a row times a column", 2);
  });

  it("without a paper viewer (e.g. /dev/ask): says there's no paper on screen", async () => {
    const h = harness(asking);
    expect(await h.tools.highlight_paper?.({ quote: "q" })).toBe(
      NO_PAPER_VIEWER,
    );
  });

  it("after Ask closed: Ask is closed, nothing highlighted", async () => {
    const highlightPaper = vi.fn(() => "ok");
    const h = harness({ kind: "paused", step: 0 }, { highlightPaper });
    expect(await h.tools.highlight_paper?.({ quote: "q" })).toBe(ASK_CLOSED);
    expect(highlightPaper).not.toHaveBeenCalled();
  });
});

describe("pointed: a highlight that lands tags the answer (issue #91)", () => {
  it("a highlight on the board that lands: pointed at the board", async () => {
    const pointed = vi.fn();
    const h = harness(asking, { pointed });
    await h.tools.highlight?.({ target_id: "label" });
    expect(pointed).toHaveBeenCalledWith("board");
  });

  it("a rejected highlight, or one while the Answer view is up: not pointed", async () => {
    const pointed = vi.fn();
    await harness(asking, { pointed }).tools.highlight?.({ target_id: "x" });
    await harness(asking, {
      pointed,
      answerShowing: () => true,
    }).tools.highlight?.({ target_id: "label" });
    await harness({ kind: "paused", step: 0 }, { pointed }).tools.highlight?.({
      target_id: "label",
    });
    expect(pointed).not.toHaveBeenCalled();
  });

  it("a passage found in the paper: pointed at the paper; not found or no paper: not", async () => {
    const pointed = vi.fn();
    await harness(asking, {
      pointed,
      highlightPaper: () => "ok: highlighted on page 2",
    }).tools.highlight_paper?.({ quote: "q" });
    expect(pointed).toHaveBeenCalledWith("paper");
    pointed.mockClear();
    await harness(asking, {
      pointed,
      highlightPaper: () => "That passage isn't in the paper.",
    }).tools.highlight_paper?.({ quote: "q" });
    await harness(asking, { pointed }).tools.highlight_paper?.({ quote: "q" });
    expect(pointed).not.toHaveBeenCalled();
  });
});

describe("agent config tool names", () => {
  // ROADMAP Q4: the agent's client tools in agent/tool_configs (area B) must
  // match shared/tools.ts. Each config present is checked here; that every
  // tool has a config comes with Q1.
  const dir = path.join(process.cwd(), "agent/tool_configs");
  const configs = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      file: f,
      config: JSON.parse(
        readFileSync(path.join(dir, f), "utf8"),
      ) as AgentToolConfig,
    }));

  it("has at least one config to check", () => {
    expect(configs.length).toBeGreaterThan(0);
  });

  it.each(configs)(
    "$file names a tool in shared/tools.ts, same params",
    ({ config }) => {
      expect(config.type).toBe("client");
      expect(CLIENT_TOOL_NAMES).toContain(config.name);
      const tool = CLIENT_TOOLS.find((t) => t.name === config.name)!;
      expect(config.expects_response).toBe(tool.expectsResponse);
      const schema = z.toJSONSchema(tool.parameters, { io: "input" }) as {
        required?: string[];
        properties: Record<string, { type: string; description?: string }>;
      };
      const params = config.parameters;
      expect([...(params.required ?? [])].sort()).toEqual(
        [...(schema.required ?? [])].sort(),
      );
      expect(Object.keys(params.properties).sort()).toEqual(
        Object.keys(schema.properties).sort(),
      );
      for (const [key, prop] of Object.entries(params.properties)) {
        expect(prop.type, key).toBe(schema.properties[key].type);
        expect(prop.description, key).toBe(schema.properties[key].description);
      }
    },
  );
});

describe("simplify_upcoming (issue #102)", () => {
  it("records the reason and returns nothing (no wait)", async () => {
    const simplifyUpcoming = vi.fn();
    const h = harness(asking, { simplifyUpcoming });
    expect(
      await h.tools.simplify_upcoming?.({ reason: "too fast" }),
    ).toBeUndefined();
    expect(simplifyUpcoming).toHaveBeenCalledWith("too fast");
  });

  it("without a recorder (/dev/ask) only logs", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const h = harness(asking);
    expect(
      await h.tools.simplify_upcoming?.({ reason: "too fast" }),
    ).toBeUndefined();
    expect(info).toHaveBeenCalled();
    info.mockRestore();
  });
});

describe("draw_scene", () => {
  it("waits: resolves Shown: <narration> once the narrated answer has played (qa/drawScene.ts)", async () => {
    const sketch = {
      narration: "Here is [[box]]a box.",
      objects: [{ kind: "text", id: "t", x: 800, y: 400, text: "a box" }],
      actions: [],
    };
    const playAnswer = vi.fn(async () => ({ kind: "shown" }) as const);
    const { tools } = harness(asking, {
      playAnswer,
      fetch: vi.fn(async () =>
        Response.json({
          sketch,
          audioUrl: "/api/runs/lesson-1/answers/a.mp3",
          cueTimes: { box: 300 },
        }),
      ),
      fetchAudio: async () => new Blob([]),
    });
    const result = await tools.draw_scene?.({
      description: "a box",
      fresh: false,
    });
    expect(playAnswer).toHaveBeenCalledOnce();
    expect(result).toBe("Shown: Here is a box.");
  });

  it(`after Ask closed: "${ASK_CLOSED}", nothing requested`, async () => {
    const fetch = vi.fn();
    const { tools } = harness({ kind: "playing", step: 0 }, { fetch });
    expect(
      await tools.draw_scene?.({ description: "a box", fresh: false }),
    ).toBe(ASK_CLOSED);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks for a fresh answer board even when the agent passed fresh: false", () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    const tools = createClientTools({
      board: () => board,
      highlight: () => {},
      send: () => ({ outcome: "ignored", state: asking }),
      isAsking: () => true,
      askId: () => 1,
      lessonId: "lesson-1",
      playAnswer: async () => ({ kind: "shown" }),
      showNotice: () => {},
      fetch,
    });
    tools.draw_scene?.({ description: "a box", fresh: false });
    const init = (fetch.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      fresh: true,
      board: { objects: [] },
    });
  });
});

describe("lesson control tools (issue #93)", () => {
  it.each([
    ["resume_lesson", "resume"],
    ["pause_lesson", "pause"],
    ["next_step", "next"],
    ["previous_step", "previous"],
    ["replay_step", "replay"],
  ] as const)(
    "%s runs control(%s) once the agent has finished speaking, returning nothing",
    async (tool, command) => {
      const control = vi.fn();
      const commanded = vi.fn();
      let later: (() => void) | null = null;
      const h = harness(asking, {
        control,
        commanded,
        afterAgentSpeaks: (fn) => (later = fn),
      });
      expect(await h.tools[tool]?.({})).toBeUndefined();
      expect(control).not.toHaveBeenCalled();
      // The card hears of it at once (QA A8: no "Thinking…" while nothing will answer).
      expect(commanded).toHaveBeenCalledExactlyOnceWith(command);
      later!();
      expect(control).toHaveBeenCalledExactlyOnceWith(command);
    },
  );

  it("without a lesson (no control), they do nothing", async () => {
    const h = harness(asking);
    expect(await h.tools.resume_lesson?.({})).toBeUndefined();
    expect(h.state()).toEqual(asking);
  });
});
