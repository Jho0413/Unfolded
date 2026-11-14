// The draw_scene tool (ARCHITECTURE.md sections 7 and 8, ROADMAP Q5).
import { describe, expect, it, vi } from "vitest";
import { config } from "@/lib/config";
import {
  boardToSend,
  drawScene,
  type DrawSceneDeps,
  MAX_BOARD_OBJECTS,
  SKETCH_FETCH_TIMEOUT_MS,
  sketchFailedUpdate,
} from "@/qa/drawScene";
import type { BoardObject, BoardState, ObjectState } from "@/shared/scene";

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
const state = (object: BoardObject, visible = true): ObjectState => ({
  object,
  visible,
  highlight: null,
});
const board: BoardState = { objects: [state(q)], copies: [], active: [] };

const onBoard = {
  objects: [{ kind: "text", id: "note", x: 600, y: 400, text: "row 1" }],
  actions: [{ do: "highlight", target: { id: "q", row: 0 }, atMs: 0 }],
};
const freshOnly = {
  objects: [{ kind: "text", id: "note", x: 600, y: 400, text: "hi" }],
  actions: [{ do: "highlight", target: { id: "note" }, atMs: 200 }],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setup(
  reply: () => Promise<Response>,
  over: Partial<DrawSceneDeps> = {},
) {
  const fetchMock = vi.fn<
    (url: string, init?: RequestInit) => Promise<Response>
  >(() => reply());
  const deps = {
    board: over.board ?? (() => board),
    isAsking: vi.fn(() => true),
    drawSketch: vi.fn<DrawSceneDeps["drawSketch"]>(),
    sketchFailed: vi.fn<DrawSceneDeps["sketchFailed"]>(),
    fetch: fetchMock as unknown as typeof fetch,
    timeoutMs: over.timeoutMs,
  };
  return { deps, fetchMock };
}

function sentBody(fetchMock: ReturnType<typeof setup>["fetchMock"]) {
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/sketch");
  expect(init?.method).toBe("POST");
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  return JSON.parse(String(init?.body));
}

vi.spyOn(console, "warn").mockImplementation(() => {});

describe("drawScene", () => {
  it("posts { description, fresh, board } and draws a valid sketch on the board", async () => {
    const { deps, fetchMock } = setup(async () => json({ sketch: onBoard }));
    await drawScene(deps, "circle the first row", false);
    expect(sentBody(fetchMock)).toEqual({
      description: "circle the first row",
      fresh: false,
      board,
    });
    expect(deps.drawSketch).toHaveBeenCalledOnce();
    const [sketch, fresh] = deps.drawSketch.mock.calls[0];
    expect(fresh).toBe(false);
    expect(sketch.objects[0].id).toBe("note");
    expect(sketch.actions[0].durationMs).toBe(400);
    expect(deps.sketchFailed).not.toHaveBeenCalled();
  });

  it("fresh: sends an empty board and validates without the board's ids", async () => {
    const { deps, fetchMock } = setup(async () => json({ sketch: freshOnly }));
    await drawScene(deps, "start over", true);
    expect(sentBody(fetchMock).board).toEqual({
      objects: [],
      copies: [],
      active: [],
    });
    expect(deps.drawSketch).toHaveBeenCalledWith(expect.anything(), true);
  });

  it("fresh: a sketch naming a board id fails", async () => {
    const { deps } = setup(async () => json({ sketch: onBoard }));
    await drawScene(deps, "start over", true);
    expect(deps.drawSketch).not.toHaveBeenCalled();
    expect(deps.sketchFailed).toHaveBeenCalledWith(
      "start over",
      expect.stringContaining('unknown object "q"'),
    );
  });

  it("an { error } response fails: Couldn't draw that", async () => {
    const { deps } = setup(async () =>
      json({ error: "Couldn't draw that." }, 502),
    );
    await drawScene(deps, "x", false);
    expect(deps.sketchFailed).toHaveBeenCalledWith("x", "HTTP 502");
    expect(deps.drawSketch).not.toHaveBeenCalled();
  });

  it("a malformed 200 response fails", async () => {
    const { deps } = setup(async () => json({ nope: true }));
    await drawScene(deps, "x", false);
    expect(deps.sketchFailed).toHaveBeenCalledWith("x", "bad response");
  });

  it("a sketch invalid on the board as it is when it arrives fails", async () => {
    let current = board;
    const { deps } = setup(
      async () => {
        current = { objects: [], copies: [], active: [] }; // board changed meanwhile
        return json({ sketch: onBoard });
      },
      { board: () => current },
    );
    await drawScene(deps, "x", false);
    expect(deps.sketchFailed).toHaveBeenCalledWith(
      "x",
      expect.stringContaining('unknown object "q"'),
    );
  });

  it("a timeout fails", async () => {
    const { deps } = setup(() =>
      Promise.reject(new DOMException("timed out", "TimeoutError")),
    );
    await drawScene(deps, "x", false);
    expect(deps.sketchFailed).toHaveBeenCalledWith(
      "x",
      expect.stringContaining("TimeoutError"),
    );
  });

  it("aborts the request after timeoutMs", async () => {
    const { deps } = setup(() => new Promise<Response>(() => {}), {
      timeoutMs: 20,
    });
    deps.fetch = ((_: string, init?: RequestInit) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        ),
      )) as typeof fetch;
    await drawScene(deps, "x", false);
    expect(deps.sketchFailed).toHaveBeenCalledOnce();
  });

  it("drops a sketch, or a failure, that arrives after Ask closed", async () => {
    const ok = setup(async () => json({ sketch: onBoard }));
    ok.deps.isAsking.mockReturnValue(false);
    await drawScene(ok.deps, "x", false);
    const bad = setup(async () => json({ error: "Couldn't draw that." }, 502));
    bad.deps.isAsking.mockReturnValue(false);
    await drawScene(bad.deps, "x", false);
    for (const d of [ok.deps, bad.deps]) {
      expect(d.drawSketch).not.toHaveBeenCalled();
      expect(d.sketchFailed).not.toHaveBeenCalled();
    }
  });

  it("tells the agent to answer in words", () => {
    expect(sketchFailedUpdate("a box")).toContain('"a box"');
    expect(sketchFailedUpdate("a box")).toContain("Answer in words");
  });
});

describe("boardToSend (config.maxBoardObjects)", () => {
  const many = (n: number, visible: boolean) =>
    Array.from({ length: n }, (_, i) =>
      state({ kind: "text", id: `t${i}`, x: 10, y: 10, text: "" }, visible),
    );

  it("sends the board as is within the cap", () => {
    const b = { ...board, objects: many(MAX_BOARD_OBJECTS, true) };
    expect(boardToSend(b, false)).toBe(b);
  });

  it("over the cap, leaves hidden objects out", () => {
    const b = {
      ...board,
      objects: [...many(5, true), ...many(MAX_BOARD_OBJECTS, false)],
    };
    expect(boardToSend(b, false)?.objects).toHaveLength(5);
  });

  it("over the cap with visible objects alone fails without a request", async () => {
    const b = { ...board, objects: many(MAX_BOARD_OBJECTS + 1, true) };
    expect(boardToSend(b, false)).toBeNull();
    const { deps, fetchMock } = setup(async () => json({ sketch: onBoard }), {
      board: () => b,
    });
    await drawScene(deps, "x", false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(deps.sketchFailed).toHaveBeenCalledOnce();
  });
});

describe("browser constants match the server config", () => {
  it("MAX_BOARD_OBJECTS equals config.maxBoardObjects", () => {
    expect(MAX_BOARD_OBJECTS).toBe(config.maxBoardObjects);
  });

  it("the fetch timeout is longer than SK1's two attempts", () => {
    // config.sketch arrives with SK1 (#63); 20 s per attempt until then.
    const perAttempt =
      (config as { sketch?: { timeoutMs?: number } }).sketch?.timeoutMs ??
      20_000;
    expect(SKETCH_FETCH_TIMEOUT_MS).toBeGreaterThan(2 * perAttempt);
  });
});
