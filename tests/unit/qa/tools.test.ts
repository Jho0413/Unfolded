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
  ASK_CLOSED,
  createClientTools,
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
    isAsking: () => state.kind === "asking",
    askId: () => 1,
    drawSketch: () => {},
    showNotice: () => {},
    tellAgent: () => {},
    fetch: vi.fn(() => new Promise<Response>(() => {})),
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
  it("doesn't wait: returns nothing at once (qa/drawScene.ts does the rest)", () => {
    const result = harness(asking).tools.draw_scene?.({
      description: "a box",
      fresh: false,
    });
    expect(result).toBeUndefined();
  });
});
