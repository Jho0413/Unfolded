// The draw_scene tool (ARCHITECTURE.md sections 7 and 8, ROADMAP Q5): always a fresh answer
// board (#90).
import { describe, expect, it, vi } from "vitest";
import { config } from "@/lib/config";
import { SKETCH_FAILED } from "@/shared/lesson";
import {
  createDrawScene,
  type DrawSceneDeps,
  SKETCH_FETCH_TIMEOUT_MS,
  sketchFailedUpdate,
  stillLatest,
} from "@/qa/drawScene";

/** One request on a fresh handler. */
const drawScene = (deps: DrawSceneDeps, description: string) =>
  createDrawScene(deps)(description);

/** Valid on a fresh board: its own objects only. */
const fresh = {
  objects: [{ kind: "text", id: "note", x: 800, y: 400, text: "row 1" }],
  actions: [{ do: "highlight", target: { id: "note" }, atMs: 200 }],
};
/** Names a lesson object, which a fresh board doesn't have. */
const onLesson = {
  objects: [{ kind: "text", id: "note", x: 800, y: 400, text: "row 1" }],
  actions: [{ do: "highlight", target: { id: "q", row: 0 }, atMs: 0 }],
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
    isAsking: vi.fn(() => true),
    askId: vi.fn(() => 1),
    drawSketch: vi.fn<DrawSceneDeps["drawSketch"]>(),
    showNotice: vi.fn<DrawSceneDeps["showNotice"]>(),
    tellAgent: vi.fn<DrawSceneDeps["tellAgent"]>(),
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

/** A failure shows SKETCH_FAILED, tells the agent, and logs `reason`. */
function expectFailed(
  deps: ReturnType<typeof setup>["deps"],
  description: string,
  reason: unknown,
) {
  expect(deps.showNotice).toHaveBeenCalledWith(SKETCH_FAILED);
  expect(deps.tellAgent).toHaveBeenCalledWith(sketchFailedUpdate(description));
  expect(warn).toHaveBeenLastCalledWith("[qa] draw_scene failed:", reason);
  expect(deps.drawSketch).not.toHaveBeenCalled();
}

function expectSilent(deps: ReturnType<typeof setup>["deps"]) {
  expect(deps.showNotice).not.toHaveBeenCalledWith(SKETCH_FAILED);
  expect(deps.tellAgent).not.toHaveBeenCalled();
}

const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

describe("drawScene", () => {
  it("always posts { description, fresh: true, an empty board } and draws the sketch fresh, with its description", async () => {
    const { deps, fetchMock } = setup(async () => json({ sketch: fresh }));
    await drawScene(deps, "circle the first row");
    expect(sentBody(fetchMock)).toEqual({
      description: "circle the first row",
      fresh: true,
      board: { objects: [], copies: [], active: [] },
    });
    expect(deps.drawSketch).toHaveBeenCalledOnce();
    const [sketch, description] = deps.drawSketch.mock.calls[0];
    expect(description).toBe("circle the first row");
    expect(sketch.objects[0].id).toBe("note");
    expect(sketch.actions[0].durationMs).toBe(400);
    expect(deps.showNotice).toHaveBeenCalledWith(null); // a success clears an earlier failure
    expectSilent(deps);
  });

  it("a sketch naming a lesson object fails: the answer board is empty", async () => {
    const { deps } = setup(async () => json({ sketch: onLesson }));
    await drawScene(deps, "circle it");
    expectFailed(
      deps,
      "circle it",
      expect.stringContaining('unknown object "q"'),
    );
  });

  it("a sketch breaking the answer template fails in the browser too", async () => {
    const offArea = {
      objects: [{ kind: "text", id: "note", x: 20, y: 400, text: "far left" }],
      actions: [],
    };
    const { deps } = setup(async () => json({ sketch: offArea }));
    await drawScene(deps, "x");
    expectFailed(
      deps,
      "x",
      expect.stringContaining('outside the answer area "note"'),
    );
  });

  it("a sketch whose only problems are spacing is drawn (spacing is soft)", async () => {
    const cramped = {
      objects: [
        { kind: "latex", id: "f", x: 700, y: 450, tex: "x" },
        { kind: "latex", id: "g", x: 760, y: 450, tex: "y" },
      ],
      actions: [],
    };
    const { deps } = setup(async () => json({ sketch: cramped }));
    await drawScene(deps, "x and y");
    expect(deps.drawSketch).toHaveBeenCalledOnce();
    expect(deps.drawSketch.mock.calls[0][0].objects.map((o) => o.id)).toEqual([
      "f",
      "g",
    ]);
    expectSilent(deps);
  });

  it("an { error } response fails: Couldn't draw that", async () => {
    const { deps } = setup(async () => json({ error: SKETCH_FAILED }, 502));
    await drawScene(deps, "x");
    expectFailed(deps, "x", "HTTP 502");
  });

  it("a malformed 200 response fails", async () => {
    const { deps } = setup(async () => json({ nope: true }));
    await drawScene(deps, "x");
    expectFailed(deps, "x", "bad response");
  });

  it("a timeout fails", async () => {
    const { deps } = setup(() =>
      Promise.reject(new DOMException("timed out", "TimeoutError")),
    );
    await drawScene(deps, "x");
    expectFailed(deps, "x", expect.stringContaining("TimeoutError"));
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
    await drawScene(deps, "x");
    expect(deps.showNotice).toHaveBeenCalledWith(SKETCH_FAILED);
    expect(deps.tellAgent).toHaveBeenCalledOnce();
  });

  it("drops a sketch, or a failure, that arrives after Ask closed", async () => {
    const ok = setup(async () => json({ sketch: fresh }));
    ok.deps.isAsking.mockReturnValue(false);
    await drawScene(ok.deps, "x");
    const bad = setup(async () => json({ error: SKETCH_FAILED }, 502));
    bad.deps.isAsking.mockReturnValue(false);
    await drawScene(bad.deps, "x");
    for (const d of [ok.deps, bad.deps]) {
      expect(d.drawSketch).not.toHaveBeenCalled();
      expectSilent(d);
    }
  });

  it("drops a sketch, or a failure, from an earlier Ask session after Ask reopened", async () => {
    for (const reply of [
      async () => json({ sketch: fresh }),
      async () => json({ error: SKETCH_FAILED }, 502),
    ]) {
      let session = 1;
      const { deps } = setup(async () => {
        session = 2; // closed and reopened while the sketch was being made
        return reply();
      });
      deps.askId.mockImplementation(() => session);
      await drawScene(deps, "x");
      expect(deps.drawSketch).not.toHaveBeenCalled();
      expectSilent(deps);
    }
  });

  it("tells the agent to answer in words", () => {
    expect(sketchFailedUpdate("a box")).toContain('"a box"');
    expect(sketchFailedUpdate("a box")).toContain("Answer in words");
  });
});

// The Answer view table's "latest only" row (ARCHITECTURE.md section 5.6).
describe("latest request only", () => {
  /** A fetch whose replies the test releases one by one, in any order. */
  function gatedFetch() {
    const pending: ((r: Response) => void)[] = [];
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => pending.push(resolve)),
    );
    return { fetchMock, reply: (i: number, r: Response) => pending[i](r) };
  }
  const sketchNamed = (id: string) => ({
    objects: [{ kind: "text", id, x: 800, y: 400, text: id }],
    actions: [],
  });
  function twoRequests() {
    const gate = gatedFetch();
    const { deps } = setup(async () => json({}));
    deps.fetch = gate.fetchMock as unknown as typeof fetch;
    const draw = createDrawScene(deps);
    return { gate, deps, a: draw("A"), b: draw("B") };
  }

  it("A slow, B fast: B is drawn, A is dropped when it arrives", async () => {
    const { gate, deps, a, b } = twoRequests();
    await vi.waitFor(() => expect(gate.fetchMock).toHaveBeenCalledTimes(2));
    gate.reply(1, json({ sketch: sketchNamed("b") }));
    await b;
    gate.reply(0, json({ sketch: sketchNamed("a") }));
    await a;
    expect(deps.drawSketch).toHaveBeenCalledOnce();
    expect(deps.drawSketch.mock.calls[0][1]).toBe("B");
    expectSilent(deps);
  });

  it("A fails late, after B was drawn: no notice, the agent isn't told, B stays", async () => {
    const { gate, deps, a, b } = twoRequests();
    await vi.waitFor(() => expect(gate.fetchMock).toHaveBeenCalledTimes(2));
    gate.reply(1, json({ sketch: sketchNamed("b") }));
    await b;
    gate.reply(0, json({ error: SKETCH_FAILED }, 502));
    await a;
    expect(deps.drawSketch).toHaveBeenCalledOnce();
    expectSilent(deps);
  });

  it("A answers while B is still in flight: A is dropped too", async () => {
    const { gate, deps, a } = twoRequests();
    await vi.waitFor(() => expect(gate.fetchMock).toHaveBeenCalledTimes(2));
    gate.reply(0, json({ sketch: sketchNamed("a") }));
    await a;
    expect(deps.drawSketch).not.toHaveBeenCalled();
    expectSilent(deps);
  });

  it("stillLatest: only the open Ask session's newest request counts", () => {
    const now = { asking: true, askId: 2, newest: 5 };
    expect(stillLatest({ askId: 2, n: 5 }, now)).toBe(true);
    expect(stillLatest({ askId: 2, n: 4 }, now)).toBe(false);
    expect(stillLatest({ askId: 1, n: 5 }, now)).toBe(false);
    expect(stillLatest({ askId: 2, n: 5 }, { ...now, asking: false })).toBe(
      false,
    );
  });
});

describe("browser constants match the server config", () => {
  it("the fetch timeout is longer than SK1's two attempts", () => {
    expect(SKETCH_FETCH_TIMEOUT_MS).toBeGreaterThan(
      2 * config.sketch.timeoutMs,
    );
  });
});
