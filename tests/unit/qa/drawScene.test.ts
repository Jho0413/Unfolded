// The draw_scene tool (ARCHITECTURE.md sections 7 and 8, ROADMAP Q5): always a fresh answer
// board (#90), narrated like a lesson step (#105): one test per row of #105's table that the
// tool owns (preparing, arriving, failing, dropped, and what the agent hears back).
import { describe, expect, it, vi } from "vitest";
import { config } from "@/lib/config";
import { SKETCH_FAILED } from "@/shared/lesson";
import {
  ANSWER_LEFT,
  answerAudioOf,
  answerPausedResult,
  answerShownResult,
  createDrawScene,
  type DrawSceneDeps,
  type PlayedOutcome,
  SKETCH_FETCH_TIMEOUT_MS,
  SKETCH_SUPERSEDED,
  sketchFailedUpdate,
  stillLatest,
} from "@/qa/drawScene";

/** The tool's result for the last `drawScene` call: what the agent hears back. */
let lastResult: string | undefined;
/** One request on a fresh handler. */
const drawScene = async (deps: DrawSceneDeps, description: string) =>
  (lastResult = await createDrawScene(deps)(description));

const NARRATION = "Here is [[row]]the first row, and [[sum]]its sum.";
const CUES = { row: 200, sum: 900 };
const AUDIO_URL = "/api/runs/lesson-1/answers/a1.mp3";
/** Valid on a fresh board: its own objects only. */
const fresh = {
  narration: NARRATION,
  objects: [{ kind: "text", id: "note", x: 800, y: 400, text: "row 1" }],
  actions: [{ do: "highlight", target: { id: "note" }, cue: "row" }],
};
/** Names a lesson object, which a fresh board doesn't have. */
const onLesson = {
  narration: NARRATION,
  objects: [{ kind: "text", id: "note", x: 800, y: 400, text: "row 1" }],
  actions: [{ do: "highlight", target: { id: "q", row: 0 }, cue: "row" }],
};
/** The route's narrated answer for a sketch (#105). */
const answer = (sketch: unknown, cueTimes: object = CUES) => ({
  sketch,
  audioUrl: AUDIO_URL,
  cueTimes,
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const AUDIO = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" });

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
    lessonId: "lesson-1",
    playAnswer: vi.fn<DrawSceneDeps["playAnswer"]>(
      async (): Promise<PlayedOutcome> => ({ kind: "shown" }),
    ),
    showNotice: vi.fn<DrawSceneDeps["showNotice"]>(),
    sketching: vi.fn<NonNullable<DrawSceneDeps["sketching"]>>(),
    fetch: fetchMock as unknown as typeof fetch,
    fetchAudio: vi.fn<(url: string) => Promise<Blob>>(async () => AUDIO),
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

/** A failure shows SKETCH_FAILED, tells the agent through the tool's result, and logs `reason`. */
function expectFailed(
  deps: ReturnType<typeof setup>["deps"],
  description: string,
  reason: unknown,
) {
  expect(deps.showNotice).toHaveBeenCalledWith(SKETCH_FAILED);
  expect(lastResult).toBe(sketchFailedUpdate(description));
  expect(warn).toHaveBeenLastCalledWith("[qa] draw_scene failed:", reason);
  expect(deps.playAnswer).not.toHaveBeenCalled();
  // Back to "none": the card no longer says "Sketching…".
  expect(deps.sketching).toHaveBeenLastCalledWith(false);
}

function expectSilent(deps: ReturnType<typeof setup>["deps"]) {
  expect(deps.showNotice).not.toHaveBeenCalledWith(SKETCH_FAILED);
}

const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

describe("drawScene", () => {
  it("always posts { description, fresh: true, an empty board, the lessonId }", async () => {
    const { deps, fetchMock } = setup(async () => json(answer(fresh)));
    await drawScene(deps, "circle the first row");
    expect(sentBody(fetchMock)).toEqual({
      description: "circle the first row",
      fresh: true,
      board: { objects: [], copies: [], active: [] },
      lessonId: "lesson-1",
    });
  });

  it("none x draw_scene called: preparing, the card says Sketching…, nothing drawn yet", async () => {
    let release: (r: Response) => void = () => {};
    const { deps } = setup(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );
    const result = createDrawScene(deps)("circle the first row");
    expect(deps.sketching).toHaveBeenCalledWith(true);
    expect(deps.sketching).not.toHaveBeenCalledWith(false);
    expect(deps.playAnswer).not.toHaveBeenCalled();
    release(json(answer(fresh)));
    await result;
  });

  it("preparing x answer + audio arrive: playing, with the sketch, its cue times and its audio", async () => {
    const { deps } = setup(async () => json(answer(fresh)));
    await drawScene(deps, "circle the first row");
    expect(deps.fetchAudio).toHaveBeenCalledWith(AUDIO_URL);
    expect(deps.playAnswer).toHaveBeenCalledOnce();
    const [arrived, description] = deps.playAnswer.mock.calls[0];
    expect(description).toBe("circle the first row");
    expect(arrived.sketch.objects[0].id).toBe("note");
    expect(arrived.sketch.actions[0].durationMs).toBe(400);
    expect(arrived.cueTimes).toEqual(CUES);
    expect(arrived.audio).toBe(AUDIO);
    expect(deps.sketching).toHaveBeenLastCalledWith(false);
    expect(deps.showNotice).toHaveBeenCalledWith(null); // a success clears an earlier failure
    expectSilent(deps);
  });

  it("playing x narration ends: draw_scene resolves Shown: <narration>, markers stripped", async () => {
    const { deps } = setup(async () => json(answer(fresh)));
    await drawScene(deps, "x");
    expect(lastResult).toBe(answerShownResult(NARRATION));
    expect(lastResult).toBe("Shown: Here is the first row, and its sum.");
  });

  it("playing x the learner speaks: draw_scene resolves with what they had heard", async () => {
    const { deps } = setup(async () => json(answer(fresh)));
    deps.playAnswer.mockResolvedValue({ kind: "paused", tMs: 500 });
    await drawScene(deps, "x");
    expect(lastResult).toBe(answerPausedResult(NARRATION, CUES, 500));
    expect(lastResult).toBe("Paused after: Here is the first row, and…");
  });

  it("paused before the first word: nothing heard yet", () => {
    expect(answerPausedResult("[[a]]Hi there.", { a: 300 }, 0)).toBe(
      "Paused after: (nothing yet)",
    );
  });

  it("the learner leaves the answer (Ask closes, or a newer one replaces it): ANSWER_LEFT", async () => {
    const { deps } = setup(async () => json(answer(fresh)));
    deps.playAnswer.mockResolvedValue({ kind: "left" });
    await drawScene(deps, "x");
    expect(lastResult).toBe(ANSWER_LEFT);
  });

  it("playing x audio fails to load: degrade, the answer plays with no audio (shown whole), logged", async () => {
    const { deps } = setup(async () => json(answer(fresh)));
    deps.fetchAudio.mockRejectedValue(new Error("HTTP 404"));
    await drawScene(deps, "x");
    expect(deps.playAnswer).toHaveBeenCalledOnce();
    expect(deps.playAnswer.mock.calls[0][0].audio).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[qa] draw_scene: the answer's audio failed to load:",
      expect.any(Error),
    );
    expectSilent(deps);
  });

  it("Ask closes while the audio downloads: dropped", async () => {
    const { deps } = setup(async () => json(answer(fresh)));
    deps.fetchAudio.mockImplementation(async () => {
      deps.isAsking.mockReturnValue(false);
      return AUDIO;
    });
    await drawScene(deps, "x");
    expect(deps.playAnswer).not.toHaveBeenCalled();
    expect(lastResult).toBe(SKETCH_SUPERSEDED);
  });

  it("a response whose audioUrl isn't an answers URL fails (never a model-written URL)", async () => {
    const { deps } = setup(async () =>
      json({ ...answer(fresh), audioUrl: "https://example.com/a.mp3" }),
    );
    await drawScene(deps, "x");
    expectFailed(deps, "x", "bad response");
  });

  it("a response whose audio is another lesson's fails (the boundary check on the route's URL)", async () => {
    const { deps } = setup(async () =>
      json({
        ...answer(fresh),
        audioUrl: "/api/runs/other-lesson/answers/a1.mp3",
      }),
    );
    await drawScene(deps, "x");
    expectFailed(deps, "x", "bad response");
  });

  it("answerAudioOf: only the lesson's own answers folder", () => {
    expect(answerAudioOf(AUDIO_URL, "lesson-1")).toBe(true);
    expect(answerAudioOf(AUDIO_URL, "lesson")).toBe(false);
    expect(answerAudioOf("/api/runs/lesson-1/step-0.v1.mp3", "lesson-1")).toBe(
      false,
    );
  });

  it("a response with no cue times fails", async () => {
    const { deps } = setup(async () =>
      json({ sketch: fresh, audioUrl: AUDIO_URL }),
    );
    await drawScene(deps, "x");
    expectFailed(deps, "x", "bad response");
  });

  it("a sketch whose cue isn't in its narration fails in the browser too", async () => {
    const offCue = {
      ...fresh,
      actions: [{ ...fresh.actions[0], cue: "nowhere" }],
    };
    const { deps } = setup(async () => json(answer(offCue)));
    await drawScene(deps, "x");
    expectFailed(deps, "x", expect.stringContaining('unknown cue "nowhere"'));
  });

  it("a sketch naming a lesson object fails: the answer board is empty", async () => {
    const { deps } = setup(async () => json(answer(onLesson)));
    await drawScene(deps, "circle it");
    expectFailed(
      deps,
      "circle it",
      expect.stringContaining('unknown object "q"'),
    );
  });

  it("a sketch breaking the answer template fails in the browser too", async () => {
    const offArea = {
      narration: NARRATION,
      objects: [{ kind: "text", id: "note", x: 20, y: 400, text: "far left" }],
      actions: [],
    };
    const { deps } = setup(async () => json(answer(offArea)));
    await drawScene(deps, "x");
    expectFailed(
      deps,
      "x",
      expect.stringContaining('outside the answer area "note"'),
    );
  });

  it("a sketch whose only problems are overlaps is drawn (spacing is soft)", async () => {
    const cramped = {
      narration: NARRATION,
      objects: [
        { kind: "latex", id: "f", x: 700, y: 450, tex: "x" },
        { kind: "latex", id: "g", x: 715, y: 450, tex: "y" },
      ],
      actions: [],
    };
    const { deps } = setup(async () => json(answer(cramped)));
    await drawScene(deps, "x and y");
    expect(deps.playAnswer).toHaveBeenCalledOnce();
    expect(
      deps.playAnswer.mock.calls[0][0].sketch.objects.map((o) => o.id),
    ).toEqual(["f", "g"]);
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
    expect(lastResult).toBe(sketchFailedUpdate("x"));
  });

  it("drops a sketch, or a failure, that arrives after Ask closed", async () => {
    const ok = setup(async () => json(answer(fresh)));
    ok.deps.isAsking.mockReturnValue(false);
    await drawScene(ok.deps, "x");
    const bad = setup(async () => json({ error: SKETCH_FAILED }, 502));
    bad.deps.isAsking.mockReturnValue(false);
    await drawScene(bad.deps, "x");
    for (const d of [ok.deps, bad.deps]) {
      expect(d.playAnswer).not.toHaveBeenCalled();
      expectSilent(d);
    }
    expect(lastResult).toBe(SKETCH_SUPERSEDED);
  });

  it("drops a sketch, or a failure, from an earlier Ask session after Ask reopened", async () => {
    for (const reply of [
      async () => json(answer(fresh)),
      async () => json({ error: SKETCH_FAILED }, 502),
    ]) {
      let session = 1;
      const { deps } = setup(async () => {
        session = 2; // closed and reopened while the sketch was being made
        return reply();
      });
      deps.askId.mockImplementation(() => session);
      await drawScene(deps, "x");
      expect(deps.playAnswer).not.toHaveBeenCalled();
      expectSilent(deps);
      expect(lastResult).toBe(SKETCH_SUPERSEDED);
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
  const sketchNamed = (id: string) =>
    answer({
      narration: NARRATION,
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
    gate.reply(1, json(sketchNamed("b")));
    await b;
    gate.reply(0, json(sketchNamed("a")));
    expect(await a).toBe(SKETCH_SUPERSEDED);
    expect(deps.playAnswer).toHaveBeenCalledOnce();
    expect(deps.playAnswer.mock.calls[0][1]).toBe("B");
    expectSilent(deps);
  });

  it("A fails late, after B was drawn: no notice, A's result says it was superseded, B stays", async () => {
    const { gate, deps, a, b } = twoRequests();
    await vi.waitFor(() => expect(gate.fetchMock).toHaveBeenCalledTimes(2));
    gate.reply(1, json(sketchNamed("b")));
    await b;
    gate.reply(0, json({ error: SKETCH_FAILED }, 502));
    expect(await a).toBe(SKETCH_SUPERSEDED);
    expect(deps.playAnswer).toHaveBeenCalledOnce();
    expectSilent(deps);
  });

  it("A answers while B is still in flight: A is dropped too", async () => {
    const { gate, deps, a } = twoRequests();
    await vi.waitFor(() => expect(gate.fetchMock).toHaveBeenCalledTimes(2));
    gate.reply(0, json(sketchNamed("a")));
    expect(await a).toBe(SKETCH_SUPERSEDED);
    expect(deps.playAnswer).not.toHaveBeenCalled();
    expectSilent(deps);
    // B is still being made: the card keeps saying "Sketching…".
    expect(deps.sketching).not.toHaveBeenCalledWith(false);
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
  it("the fetch timeout is longer than SK1's two attempts plus voicing the narration", () => {
    expect(SKETCH_FETCH_TIMEOUT_MS).toBeGreaterThan(
      2 * config.sketch.timeoutMs + config.tts.timeoutMs,
    );
  });
});
