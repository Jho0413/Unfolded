// POST /api/sketch (ROADMAP SK1, ARCHITECTURE.md sections 4, 7 and 8). One test per case,
// named after it. Claude is never called: each test scripts lib/fakes/claude.ts, or runs with
// FAKE_APIS=1 and its recorded fixture.
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/sketch/route";
import { config } from "@/lib/config";
import { resetEnvForTests } from "@/lib/env";
import { readFixture } from "@/lib/fakes";
import {
  fakeClaude,
  fakeMessage,
  type FakeClaude,
  type FakeReply,
} from "@/lib/fakes/claude";
import { ApiError, SKETCH_FAILED, SketchResponse } from "@/shared/lesson";
import { ANSWER_TEMPLATE, errors } from "@/shared/validate";
import {
  type BoardState,
  type ObjectState,
  type Sketch,
  Step,
} from "@/shared/scene";

// The Claude the route gets: a scripted fake per test, or the real factory (FAKE_APIS=1).
const claude = vi.hoisted(() => ({
  current: undefined as FakeClaude | undefined,
}));
vi.mock("@/lib/pipeline/generate", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/pipeline/generate")>();
  return {
    ...real,
    claudeMessages: (fixture: string) =>
      claude.current ?? real.claudeMessages(fixture),
  };
});

function script(...replies: FakeReply[]) {
  claude.current = fakeClaude(replies);
  return claude.current;
}

const matrixA: ObjectState = {
  object: {
    kind: "matrix",
    id: "a",
    x: 100,
    y: 100,
    rows: [
      ["1", "2"],
      ["3", "4"],
    ],
  },
  visible: true,
  highlight: null,
  cellHighlight: [
    [null, null],
    [null, null],
  ],
};
const BOARD: BoardState = { objects: [matrixA], copies: [], active: [] };
const EMPTY: BoardState = { objects: [], copies: [], active: [] };

/** Highlights row 0 of the board's matrix `a` and points a new note at it. */
const TARGETS_BOARD: Sketch = {
  objects: [
    { kind: "text", id: "note", x: 600, y: 120, text: "this row" },
    {
      kind: "arrow",
      id: "pointer",
      from: { id: "note" },
      to: { id: "a", row: 0 },
    },
  ],
  actions: [
    {
      do: "highlight",
      target: { id: "a", row: 0 },
      color: "accent",
      durationMs: 400,
      atMs: 0,
    },
    { do: "show", target: { id: "note" }, durationMs: 400, atMs: 800 },
  ],
};

/** A new object reusing the board's id `a`. */
const REUSES_BOARD_ID: Sketch = {
  objects: [{ kind: "text", id: "a", x: 600, y: 120, text: "a clash" }],
  actions: [],
};

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/sketch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const reply = (sketch: unknown) => fakeMessage(JSON.stringify(sketch));

function quietLogs() {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const text = (spy: typeof warn) =>
    spy.mock.calls.flat().map(String).join(" ");
  return { warned: () => text(warn), logged: () => text(error) };
}

async function expectFailed(res: Response, status: number) {
  expect(res.status).toBe(status);
  const body: unknown = await res.json();
  expect(ApiError.parse(body)).toEqual({ error: SKETCH_FAILED });
  expect(body).not.toHaveProperty("sketch");
}

afterEach(() => {
  claude.current = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe("POST /api/sketch: a fresh answer and its template (#90)", () => {
  /** A valid answer board: a title and a formula. */
  const ANSWER: Sketch = {
    objects: [
      { kind: "text", id: "title", x: 800, y: 110, text: "Why scale?" },
      { kind: "latex", id: "f", x: 800, y: 450, tex: "\\frac{40}{8}=5" },
    ],
    actions: [{ do: "show", target: { id: "f" }, durationMs: 400, atMs: 0 }],
  };
  /** The research run's failure: d_k in plain text, and an object off the area. */
  const SCATTERED: Sketch = {
    objects: [
      { kind: "text", id: "title", x: 800, y: 110, text: "Why divide by d_k?" },
      { kind: "latex", id: "f", x: 1560, y: 450, tex: "\\frac{40}{8}=5" },
    ],
    actions: [],
  };

  /** Two formulas about 37 apart: only a spacing problem, so still drawable. */
  const CRAMPED: Sketch = {
    objects: [
      { kind: "text", id: "title", x: 800, y: 110, text: "Why scale?" },
      { kind: "latex", id: "f", x: 700, y: 450, tex: "x" },
      { kind: "latex", id: "g", x: 760, y: 450, tex: "y" },
    ],
    actions: [],
  };
  /** Three formulas side by side, each pair too close: more spacing problems. */
  const MORE_CRAMPED: Sketch = {
    ...CRAMPED,
    objects: [
      ...CRAMPED.objects,
      { kind: "latex", id: "h", x: 820, y: 450, tex: "z" },
    ],
  };

  it("spacing only, twice: retried with the feedback, then 200 with the attempt with fewer spacing problems, and a warning", async () => {
    const logs = quietLogs();
    const fake = script(reply(CRAMPED), reply(MORE_CRAMPED));
    const res = await post({ description: "why", fresh: true, board: EMPTY });
    expect(res.status).toBe(200);
    expect(SketchResponse.parse(await res.json()).sketch).toEqual(CRAMPED);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].body.messages.at(-1)?.content).toContain(
      errors.tooClose("f", "g", ANSWER_TEMPLATE.gap),
    );
    expect(logs.warned()).toContain("used with soft problems only");
  });

  it("hard, then spacing only: 200 with the second", async () => {
    quietLogs();
    const hardFirst: Sketch = {
      ...CRAMPED,
      objects: [{ kind: "text", id: "t", x: 800, y: 110, text: "d_k" }],
    };
    script(reply(hardFirst), reply(CRAMPED));
    const res = await post({ description: "why", fresh: true, board: EMPTY });
    expect(res.status).toBe(200);
    expect(SketchResponse.parse(await res.json()).sketch).toEqual(CRAMPED);
  });

  it("rejected twice: the second attempt's output goes to the server log", async () => {
    const logs = quietLogs();
    script(reply(SCATTERED), reply(SCATTERED));
    const res = await post({ description: "why", fresh: true, board: EMPTY });
    await expectFailed(res, 502);
    expect(logs.logged()).toContain("rejected output (second attempt)");
    expect(logs.logged()).toContain('"Why divide by d_k?"');
  });

  it("a sketch breaking the template: retried once with the template's errors, 200 with the fixed one", async () => {
    const logs = quietLogs();
    const fake = script(reply(SCATTERED), reply(ANSWER));
    const res = await post({
      description: "why scale",
      fresh: true,
      board: EMPTY,
    });
    expect(res.status).toBe(200);
    expect(SketchResponse.parse(await res.json()).sketch).toEqual(ANSWER);
    const retry = fake.calls[1].body.messages.at(-1)?.content;
    expect(retry).toContain(errors.mathsInPlainText("title"));
    expect(retry).toContain(errors.outsideAnswerArea("f"));
    expect(logs.warned()).toContain(errors.mathsInPlainText("title"));
  });

  it('the research request s3-mix, whose two answers wrote to "mix" with no value: Couldn\'t draw that (502), as before the fix', async () => {
    // /tmp/sketch-research/req-s3-mix.json and resp-s3-mix.json (2026-11-14): the same
    // rejection twice. The wire schema now lists every required field (atMs) before the
    // optional ones (outputFormat.test.ts), so Claude can't write past a write's value.
    const logs = quietLogs();
    const noValue = {
      objects: [
        {
          kind: "matrix",
          id: "mix",
          x: 600,
          y: 420,
          rows: [["", ""]],
          label: "output",
        },
      ],
      actions: [
        {
          do: "write",
          target: { id: "mix", row: 0, col: 0 },
          durationMs: 400,
          atMs: 4300,
        },
      ],
    };
    const fake = script(reply(noValue), reply(noValue));
    const res = await post({
      description:
        "Show how the weights 0.88 and 0.12 mix the two rows of V into the output row, step by step.",
      fresh: true,
      board: EMPTY,
    });
    await expectFailed(res, 502);
    expect(fake.calls[1].body.messages.at(-1)?.content).toContain(
      'write needs value "mix"',
    );
    expect(logs.logged()).toContain('rejected twice: write needs value "mix"');
  });
});

describe("POST /api/sketch: the sketch against the board", () => {
  it("a valid sketch that targets a board object: 200 with the sketch", async () => {
    const fake = script(reply(TARGETS_BOARD));
    const res = await post({
      description: "point at the first row",
      board: BOARD,
    });
    expect(res.status).toBe(200);
    expect(SketchResponse.parse(await res.json())).toEqual({
      sketch: TARGETS_BOARD,
    });
    expect(fake.calls).toHaveLength(1);
  });

  it("the same sketch with fresh: true: unknown object, retried once, then Couldn't draw that (502)", async () => {
    const logs = quietLogs();
    const fake = script(reply(TARGETS_BOARD), reply(TARGETS_BOARD));
    const res = await post({
      description: "point at the first row",
      fresh: true,
      board: BOARD,
    });
    await expectFailed(res, 502);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].body.messages.at(-1)?.content).toContain(
      'unknown object "a"',
    );
    expect(logs.logged()).toContain('unknown object "a"');
  });

  it("a sketch reusing a board id: duplicate id, retried once, then Couldn't draw that (502)", async () => {
    const logs = quietLogs();
    const fake = script(reply(REUSES_BOARD_ID), reply(REUSES_BOARD_ID));
    const res = await post({ description: "label it", board: BOARD });
    await expectFailed(res, 502);
    expect(fake.calls[1].body.messages.at(-1)?.content).toContain(
      'duplicate id "a"',
    );
    expect(logs.logged()).toContain('duplicate id "a"');
  });

  it("the same id with fresh: true is allowed (the board is empty)", async () => {
    script(reply(REUSES_BOARD_ID));
    const res = await post({
      description: "label it",
      fresh: true,
      board: BOARD,
    });
    expect(res.status).toBe(200);
    expect(SketchResponse.parse(await res.json()).sketch).toEqual(
      REUSES_BOARD_ID,
    );
  });

  it("an invalid sketch, then a valid one: retried once with the errors, 200 with the valid one", async () => {
    const logs = quietLogs();
    const fake = script(reply(REUSES_BOARD_ID), reply(TARGETS_BOARD));
    const res = await post({ description: "point at it", board: BOARD });
    expect(res.status).toBe(200);
    expect(SketchResponse.parse(await res.json()).sketch).toEqual(
      TARGETS_BOARD,
    );
    expect(fake.calls).toHaveLength(2);
    expect(logs.warned()).toContain('duplicate id "a"');
  });
  it("a wire action that can't convert (a move with no to): retried with the error", async () => {
    const logs = quietLogs();
    const noTo = {
      objects: [],
      actions: [{ do: "move", target: { id: "a" }, durationMs: 400, atMs: 0 }],
    };
    const fake = script(reply(noTo), reply(TARGETS_BOARD));
    const res = await post({ description: "slide it", board: BOARD });
    expect(res.status).toBe(200);
    expect(fake.calls[1].body.messages.at(-1)?.content).toContain(
      'move needs to "a"',
    );
    expect(logs.warned()).toContain('move needs to "a"');
  });
});

describe("POST /api/sketch: an invalid sketch or a failed request is an error response, not a sketch", () => {
  it("output that fails the Sketch schema twice: 502 Couldn't draw that", async () => {
    const logs = quietLogs();
    script(reply({ objects: "nope" }), reply({ actions: [] }));
    await expectFailed(await post({ description: "x", board: BOARD }), 502);
    expect(logs.logged()).toContain("sketch: rejected twice");
  });

  it("output that isn't JSON twice: 502 Couldn't draw that", async () => {
    quietLogs();
    script(fakeMessage("not json"), fakeMessage("still not"));
    await expectFailed(await post({ description: "x", board: BOARD }), 502);
  });

  it("refusal: 502 Couldn't draw that, with no retry", async () => {
    quietLogs();
    const fake = script(fakeMessage("", "refusal"));
    await expectFailed(await post({ description: "x", board: BOARD }), 502);
    expect(fake.calls).toHaveLength(1);
  });

  it("max_tokens cut-off: 502 Couldn't draw that, with no retry", async () => {
    quietLogs();
    const fake = script(fakeMessage('{"objects": [', "max_tokens"));
    await expectFailed(await post({ description: "x", board: BOARD }), 502);
    expect(fake.calls).toHaveLength(1);
  });

  it("API error (after the SDK's retries): 502 Couldn't draw that, logged", async () => {
    const logs = quietLogs();
    script(
      new Anthropic.InternalServerError(
        529,
        undefined,
        "Overloaded",
        new Headers(),
      ),
    );
    await expectFailed(await post({ description: "x", board: BOARD }), 502);
    expect(logs.logged()).toContain("sketch: Claude request failed");
  });

  it("timeout: config.sketch.timeoutMs passing (the request aborts) gives 502 Couldn't draw that, with no retry", async () => {
    const logs = quietLogs();
    const fake = script(new Anthropic.APIUserAbortError());
    await expectFailed(await post({ description: "x", board: BOARD }), 502);
    expect(fake.calls).toHaveLength(1);
    expect(logs.logged()).toContain(
      `timed out after ${config.sketch.timeoutMs} ms`,
    );
  });

  it("an error that isn't Claude's (a bug): 500 Couldn't draw that, logged", async () => {
    const logs = quietLogs();
    script(new TypeError("boom"));
    await expectFailed(await post({ description: "x", board: BOARD }), 500);
    expect(logs.logged()).toContain("boom");
  });
});

describe("POST /api/sketch: a bad request body is a 400, and Claude isn't called", () => {
  const cases: [string, unknown][] = [
    ["not JSON", "{not json"],
    ["no description", { board: BOARD }],
    ["an empty description", { description: "", board: BOARD }],
    [
      "a description over config.sketch.maxDescriptionChars",
      {
        description: "x".repeat(config.sketch.maxDescriptionChars + 1),
        board: BOARD,
      },
    ],
    ["no board", { description: "x" }],
    [
      "a board that isn't a BoardState",
      { description: "x", board: { objects: [{}] } },
    ],
    [
      "fresh that isn't a boolean",
      { description: "x", fresh: "yes", board: BOARD },
    ],
    [
      "a board object with an invalid id",
      {
        description: "x",
        board: {
          ...BOARD,
          objects: [
            { ...matrixA, object: { ...matrixA.object, id: "Bad Id" } },
          ],
        },
      },
    ],
  ];
  for (const [name, body] of cases)
    it(`${name}: 400 Couldn't draw that`, async () => {
      const logs = quietLogs();
      const fake = script();
      await expectFailed(await post(body), 400);
      expect(fake.calls).toHaveLength(0);
      expect(logs.warned()).toContain("bad request");
    });

  /** A board of `n` distinct text objects. */
  function boardOf(n: number): BoardState {
    const objects = Array.from({ length: n }, (_, i): ObjectState => ({
      object: { kind: "text", id: `t${i}`, x: 10, y: 10, text: "" },
      visible: true,
      highlight: null,
    }));
    return { objects, copies: [], active: [] };
  }

  it("a board over config.maxBoardObjects: 400 Couldn't draw that", async () => {
    quietLogs();
    const fake = script();
    const res = await post({
      description: "x",
      board: boardOf(config.maxBoardObjects + 1),
    });
    await expectFailed(res, 400);
    expect(fake.calls).toHaveLength(0);
  });

  it("a board of exactly config.maxBoardObjects: accepted", async () => {
    script(reply({ objects: [], actions: [] }));
    const res = await post({
      description: "x",
      board: boardOf(config.maxBoardObjects),
    });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/sketch with FAKE_APIS=1", () => {
  /** The board of a step fixture: its objects as they start. */
  function boardOf(step: Step): BoardState {
    return {
      objects: step.objects.map((object) => ({
        object,
        visible: !object.hidden,
        highlight: null,
      })),
      copies: [],
      active: [],
    };
  }

  async function recordedSketch(): Promise<unknown> {
    const fixture = await readFixture<Anthropic.Message>(config.sketch.fixture);
    const text = fixture.content.find((b) => b.type === "text");
    return JSON.parse(text!.text);
  }

  const cases: [
    string,
    () => Promise<{ fresh: boolean; board: BoardState }>,
  ][] = [
    ["a fresh, empty board", async () => ({ fresh: true, board: EMPTY })],
    [
      "the demo-m1 board",
      async () => ({
        fresh: false,
        board: boardOf(Step.parse(await readFixture("demo-m1.step.json"))),
      }),
    ],
  ];
  for (const [name, request] of cases)
    it(`serves the recorded sketch response, which is valid on ${name}`, async () => {
      vi.stubEnv("FAKE_APIS", "1");
      vi.stubEnv("REPLAY_RUN", undefined);
      resetEnvForTests();
      const res = await post({ description: "anything", ...(await request()) });
      expect(res.status).toBe(200);
      expect(SketchResponse.parse(await res.json()).sketch).toEqual(
        await recordedSketch(),
      );
    });
});
