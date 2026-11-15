// POST /api/sketch (ROADMAP SK1, ARCHITECTURE.md sections 4, 7 and 8). One test per case,
// named after it. Claude is never called: each test scripts lib/fakes/claude.ts, or runs with
// FAKE_APIS=1 and its recorded fixture. The narration is voiced by the TTS fake (FAKE_APIS=1)
// and saved in a temporary runs folder (#105).
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import {
  ANSWERS_DIR,
  ApiError,
  SKETCH_FAILED,
  SketchResponse,
} from "@/shared/lesson";
import { NoAlignmentError } from "@/lib/narration/cues";
import { PLAN_FILE, writeRunJson } from "@/lib/runs/store";
import { TtsError } from "@/lib/narration/tts";
import { ANSWER_TEMPLATE, errors } from "@/shared/validate";
import {
  type BoardState,
  type ObjectState,
  type Sketch,
  Step,
} from "@/shared/scene";

/** A narrated answer's narration (#105): its one cue, "c", fires on the first word. */
const SAID = "[[c]]Here it is.";

// The Claude the route gets: a scripted fake per test, or the real factory (FAKE_APIS=1).
const claude = vi.hoisted(() => ({
  current: undefined as FakeClaude | undefined,
}));
// The voice: the TTS fake, or a failure a test sets; and the runs folder, a temporary one.
const voice = vi.hoisted(() => ({
  error: undefined as Error | undefined,
  /** Narrations whose voicing fails, while others are voiced. */
  failing: new Set<string>(),
  /** Narrations whose next voicing fails once (a passing TTS error). */
  failingOnce: new Set<string>(),
  narrated: [] as string[],
  runs: "",
}));
vi.mock("@/lib/narration/tts", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/narration/tts")>();
  return {
    ...real,
    // Always the TTS fake, whatever the mode: a route test never reaches ElevenLabs.
    narrate: (narration: string) => {
      voice.narrated.push(narration);
      if (voice.failing.has(narration) || voice.failingOnce.delete(narration))
        return Promise.reject(
          new real.TtsError("provider", `voicing failed: ${narration}`),
        );
      return voice.error
        ? Promise.reject(voice.error)
        : real.narrate(narration, { mode: "fake" });
    },
  };
});
vi.mock("@/lib/config", async (importOriginal) => {
  const { config } = await importOriginal<typeof import("@/lib/config")>();
  return {
    config: {
      ...config,
      get runsDir() {
        return voice.runs;
      },
    },
  };
});
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
  narration: SAID,
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
      cue: "c",
    },
    { do: "show", target: { id: "note" }, durationMs: 400, cue: "c" },
  ],
};

/** A new object reusing the board's id `a`. */
const REUSES_BOARD_ID: Sketch = {
  narration: SAID,
  objects: [{ kind: "text", id: "a", x: 600, y: 120, text: "a clash" }],
  actions: [],
};

/** The lesson whose run folder keeps the answers' audio. */
const LESSON = "lesson-1";

/** Posts a body; an object body gets LESSON as its lessonId unless it names its own. */
function post(body: unknown): Promise<Response> {
  const json =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? { lessonId: LESSON, ...body }
      : body;
  return POST(
    new Request("http://localhost/api/sketch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof json === "string" ? json : JSON.stringify(json),
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

beforeEach(async () => {
  voice.runs = await mkdtemp(path.join(tmpdir(), "sketch-runs-"));
  vi.stubEnv("FAKE_APIS", "1");
  resetEnvForTests();
});
afterEach(async () => {
  claude.current = undefined;
  voice.error = undefined;
  voice.failing.clear();
  voice.failingOnce.clear();
  voice.narrated = [];
  await rm(voice.runs, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe("POST /api/sketch: a fresh answer and its template (#90)", () => {
  /** A valid answer board: a title and a formula. */
  const ANSWER: Sketch = {
    narration: SAID,
    objects: [
      { kind: "text", id: "title", x: 800, y: 110, text: "Why scale?" },
      { kind: "latex", id: "f", x: 800, y: 450, tex: "\\frac{40}{8}=5" },
    ],
    actions: [{ do: "show", target: { id: "f" }, durationMs: 400, cue: "c" }],
  };
  /** The research run's failure: d_k in plain text, and an object off the area. */
  const SCATTERED: Sketch = {
    narration: SAID,
    objects: [
      { kind: "text", id: "title", x: 800, y: 110, text: "Why divide by d_k?" },
      { kind: "latex", id: "f", x: 1560, y: 450, tex: "\\frac{40}{8}=5" },
    ],
    actions: [],
  };

  /** Two formulas about 37 apart, not touching: tight spacing, only a warning. */
  const CRAMPED: Sketch = {
    narration: SAID,
    objects: [
      { kind: "text", id: "title", x: 800, y: 110, text: "Why scale?" },
      { kind: "latex", id: "f", x: 700, y: 450, tex: "x" },
      { kind: "latex", id: "g", x: 760, y: 450, tex: "y" },
    ],
    actions: [],
  };
  /** Two formulas whose boxes overlap: retried, but still drawable. */
  const OVERLAPPING: Sketch = {
    ...CRAMPED,
    objects: [
      CRAMPED.objects[0],
      { kind: "latex", id: "f", x: 700, y: 450, tex: "x" },
      { kind: "latex", id: "g", x: 715, y: 450, tex: "y" },
    ],
  };
  /** A third formula over the second: more overlaps. */
  const MORE_OVERLAPPING: Sketch = {
    ...OVERLAPPING,
    objects: [
      ...OVERLAPPING.objects,
      { kind: "latex", id: "h", x: 730, y: 450, tex: "z" },
    ],
  };

  it("tight spacing only: 200 with the first attempt, no retry, and a warning", async () => {
    const logs = quietLogs();
    const fake = script(reply(CRAMPED));
    const res = await post({ description: "why", fresh: true, board: EMPTY });
    expect(res.status).toBe(200);
    expect(SketchResponse.parse(await res.json()).sketch).toEqual(CRAMPED);
    expect(fake.calls).toHaveLength(1);
    expect(logs.warned()).toContain(
      errors.tooClose("f", "g", ANSWER_TEMPLATE.gap),
    );
  });

  it("an overlap: retried once with the feedback, 200 with a valid retry", async () => {
    quietLogs();
    const fake = script(reply(OVERLAPPING), reply(ANSWER));
    const res = await post({ description: "why", fresh: true, board: EMPTY });
    expect(res.status).toBe(200);
    expect(SketchResponse.parse(await res.json()).sketch).toEqual(ANSWER);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].body.messages.at(-1)?.content).toContain(
      errors.overlap("f", "g", ANSWER_TEMPLATE.gap),
    );
  });

  it("overlaps twice: 200 with the attempt with fewer overlaps, and a warning", async () => {
    const logs = quietLogs();
    const fake = script(reply(OVERLAPPING), reply(MORE_OVERLAPPING));
    const res = await post({ description: "why", fresh: true, board: EMPTY });
    expect(res.status).toBe(200);
    expect(SketchResponse.parse(await res.json()).sketch).toEqual(OVERLAPPING);
    expect(fake.calls).toHaveLength(2);
    expect(logs.warned()).toContain("used with soft problems only");
  });

  it("overlaps, then the retry times out: 200 with the first attempt, not Couldn't draw that", async () => {
    // A real case (2026-11-15): the layout retry hit the 20 s timeout and the answer was lost.
    const logs = quietLogs();
    const fake = script(reply(OVERLAPPING), new Anthropic.APIUserAbortError());
    const res = await post({ description: "why", fresh: true, board: EMPTY });
    expect(res.status).toBe(200);
    expect(SketchResponse.parse(await res.json()).sketch).toEqual(OVERLAPPING);
    expect(fake.calls).toHaveLength(2);
    expect(logs.warned()).toContain("retry failed, using the first attempt");
  });

  it("a hard problem, then the retry times out: 502 Couldn't draw that", async () => {
    quietLogs();
    const hardFirst: Sketch = {
      ...CRAMPED,
      objects: [{ kind: "text", id: "t", x: 20, y: 400, text: "far left" }],
    };
    script(reply(hardFirst), new Anthropic.APIUserAbortError());
    await expectFailed(
      await post({ description: "why", fresh: true, board: EMPTY }),
      502,
    );
  });

  it("hard, then overlaps only: 200 with the second", async () => {
    quietLogs();
    const hardFirst: Sketch = {
      ...CRAMPED,
      // Outside the answer area: a hard error.
      objects: [{ kind: "text", id: "t", x: 20, y: 400, text: "far left" }],
    };
    script(reply(hardFirst), reply(OVERLAPPING));
    const res = await post({ description: "why", fresh: true, board: EMPTY });
    expect(res.status).toBe(200);
    expect(SketchResponse.parse(await res.json()).sketch).toEqual(OVERLAPPING);
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
    expect(retry).toContain(errors.outsideAnswerArea("f"));
    // Its "d_k" title is repaired, not sent back as an error (shared/plainMaths.ts).
    expect(retry).not.toContain(errors.mathsInPlainText("title"));
    expect(logs.warned()).toContain(errors.outsideAnswerArea("f"));
  });

  it("maths written as plain text: repaired (d_k → dₖ), 200 at once, no retry", async () => {
    quietLogs();
    const plainMaths: Sketch = {
      ...ANSWER,
      objects: ANSWER.objects.map((o) =>
        o.kind === "text" && o.id === ANSWER.objects[0].id
          ? { ...o, text: "Why divide by d_k?" }
          : o,
      ),
    };
    const fake = script(reply(plainMaths));
    const res = await post({ description: "why", fresh: true, board: EMPTY });
    expect(res.status).toBe(200);
    const sketch = SketchResponse.parse(await res.json()).sketch;
    expect(JSON.stringify(sketch)).toContain("Why divide by dₖ?");
    expect(JSON.stringify(sketch)).not.toMatch(/d_k/);
    expect(fake.calls).toHaveLength(1);
  });

  it('the research request s3-mix, whose two answers wrote to "mix" with no value: Couldn\'t draw that (502), as before the fix', async () => {
    // /tmp/sketch-research/req-s3-mix.json and resp-s3-mix.json (2026-11-14): the same
    // rejection twice. The wire schema now lists every required field (then atMs) before the
    // optional ones (outputFormat.test.ts), so Claude can't write past a write's value.
    const logs = quietLogs();
    const noValue = {
      narration: SAID,
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
          cue: "c",
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
    expect(SketchResponse.parse(await res.json()).sketch).toEqual(
      TARGETS_BOARD,
    );
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
      narration: SAID,
      objects: [],
      actions: [{ do: "move", target: { id: "a" }, durationMs: 400, cue: "c" }],
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

// #105: the answer is narrated like a step: voiced, its cues timed, its audio saved.
describe("POST /api/sketch: a narrated answer (#105)", () => {
  const NARRATED: Sketch = {
    narration: "First [[row]]the row, then [[note]]the note.",
    objects: TARGETS_BOARD.objects,
    actions: [
      {
        do: "highlight",
        target: { id: "a", row: 0 },
        durationMs: 400,
        cue: "row",
      },
      { do: "show", target: { id: "note" }, durationMs: 400, cue: "note" },
    ],
  };
  const answersDir = () => path.join(voice.runs, LESSON, ANSWERS_DIR);

  it("answer + audio: 200 with { sketch, audioUrl, cueTimes }, the narration voiced with its markers", async () => {
    script(reply(NARRATED));
    const res = await post({ description: "point at it", board: BOARD });
    expect(res.status).toBe(200);
    const body = SketchResponse.parse(await res.json());
    expect(body.sketch).toEqual(NARRATED);
    expect(voice.narrated).toEqual([NARRATED.narration]);
    // Every cue has a time, in narration order.
    expect(Object.keys(body.cueTimes)).toEqual(["row", "note"]);
    expect(body.cueTimes.row).toBeLessThan(body.cueTimes.note);
    expect(body.audioUrl).toMatch(
      new RegExp(`^/api/runs/${LESSON}/${ANSWERS_DIR}/[0-9a-f-]+\\.mp3$`),
    );
  });

  it("the audio and a record of the answer are saved under runs/<lessonId>/answers/", async () => {
    script(reply(NARRATED));
    const res = await post({ description: "point at it", board: BOARD });
    const body = SketchResponse.parse(await res.json());
    const audio = path.basename(body.audioUrl);
    const files = (await readdir(answersDir())).sort();
    expect(files).toEqual([audio.replace(/\.mp3$/, ".json"), audio].sort());
    const record: unknown = JSON.parse(
      await readFile(
        path.join(answersDir(), audio.replace(/\.mp3$/, ".json")),
        "utf8",
      ),
    );
    expect(record).toEqual({
      description: "point at it",
      sketch: NARRATED,
      cueTimes: body.cueTimes,
    });
    expect(
      (await readFile(path.join(answersDir(), audio))).length,
    ).toBeGreaterThan(0);
  });

  it("two answers never replace each other: each gets its own files", async () => {
    script(reply(NARRATED), reply(NARRATED));
    const first = SketchResponse.parse(
      await (await post({ description: "a", board: BOARD })).json(),
    );
    const second = SketchResponse.parse(
      await (await post({ description: "b", board: BOARD })).json(),
    );
    expect(first.audioUrl).not.toBe(second.audioUrl);
    expect(await readdir(answersDir())).toHaveLength(4);
  });

  it("voicing fails (ElevenLabs): 502 Couldn't draw that, logged, nothing saved", async () => {
    const logs = quietLogs();
    script(reply(NARRATED));
    voice.error = new TtsError("provider", "ElevenLabs TTS returned 500");
    await expectFailed(
      await post({ description: "point at it", board: BOARD }),
      502,
    );
    expect(logs.logged()).toContain("ElevenLabs TTS returned 500");
    await expect(readdir(answersDir())).rejects.toThrow();
  });

  it("the voice's alignment doesn't match (no alignment): 502 Couldn't draw that", async () => {
    quietLogs();
    script(reply(NARRATED));
    voice.error = new NoAlignmentError("text", null, "alignment is null");
    await expectFailed(
      await post({ description: "point at it", board: BOARD }),
      502,
    );
  });

  describe("real mode: the lesson must exist (it keeps the answer's audio)", () => {
    function realMode() {
      vi.stubEnv("FAKE_APIS", undefined);
      vi.stubEnv("REPLAY_RUN", undefined);
      vi.stubEnv("NEXT_PUBLIC_FAKE_APIS", undefined);
      vi.stubEnv("BUILT_WITH_BROWSER_FAKES", undefined);
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
      vi.stubEnv("ELEVENLABS_VOICE_ID", "test-voice");
      resetEnvForTests();
    }

    it("a lessonId with no plan.json: 404 Couldn't draw that, no Claude or voice call, no folder made", async () => {
      const logs = quietLogs();
      realMode();
      const fake = script(reply(NARRATED));
      await expectFailed(
        await post({ description: "x", board: BOARD, lessonId: "nope" }),
        404,
      );
      expect(fake.calls).toHaveLength(0);
      expect(voice.narrated).toEqual([]);
      expect(logs.warned()).toContain("no such lesson: nope");
      await expect(readdir(path.join(voice.runs, "nope"))).rejects.toThrow();
    });

    it("a lesson with its plan: the answer is made", async () => {
      realMode();
      await writeRunJson(LESSON, PLAN_FILE, {
        title: "t",
        coverPrompt: "c",
        steps: [{ title: "s", goal: "g" }],
      });
      script(reply(NARRATED));
      const res = await post({ description: "x", board: BOARD });
      expect(res.status).toBe(200);
      expect(voice.narrated).toEqual([NARRATED.narration]);
    });
  });

  it("a sketch whose action's cue isn't in its narration: unknown cue, retried once with it", async () => {
    quietLogs();
    const offCue = {
      ...NARRATED,
      actions: [{ ...NARRATED.actions[0], cue: "elsewhere" }],
    };
    const fake = script(reply(offCue), reply(NARRATED));
    const res = await post({ description: "point at it", board: BOARD });
    expect(res.status).toBe(200);
    expect(fake.calls[1].body.messages.at(-1)?.content).toContain(
      errors.unknownCue("elsewhere"),
    );
  });
});

describe("POST /api/sketch: the narration is voiced while the sketch streams", () => {
  /** A valid answer board whose one cue, "c", fires on its first word. */
  const VALID: Sketch = {
    narration: "[[c]]Here it is.",
    objects: [
      { kind: "text", id: "title", x: 800, y: 110, text: "Why scale?" },
      { kind: "latex", id: "f", x: 800, y: 450, tex: "\\frac{40}{8}=5" },
    ],
    actions: [{ do: "show", target: { id: "f" }, durationMs: 400, cue: "c" }],
  };
  /** A formula off the answer area: a hard problem, retried. */
  const OFF_AREA: Sketch = {
    narration: "[[c]]A first try.",
    objects: [
      VALID.objects[0],
      { kind: "latex", id: "f", x: 1560, y: 450, tex: "x" },
    ],
    actions: VALID.actions,
  };
  const fresh = { description: "why", fresh: true, board: EMPTY };

  /** A Claude whose one answer streams its text at once, then waits for `release`. */
  function gatedClaude(message: Anthropic.Message) {
    let release: () => void = () => {};
    const done = new Promise<void>((r) => (release = r));
    const text = (message.content[0] as Anthropic.TextBlock).text;
    claude.current = {
      calls: [],
      stream() {
        let listener: (delta: string, snapshot: string) => void = () => {};
        return {
          on(_event, l) {
            listener = l;
            return this;
          },
          async finalMessage() {
            listener(text, text);
            await done;
            return message;
          },
        };
      },
    };
    return release;
  }

  it("the narration is voiced as soon as it has streamed, before Claude has finished the sketch", async () => {
    const release = gatedClaude(reply(VALID));
    const pending = post(fresh);
    await vi.waitFor(() => expect(voice.narrated).toEqual([VALID.narration]));
    release();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(voice.narrated).toEqual([VALID.narration]);
    expect(SketchResponse.parse(await res.json()).sketch).toEqual(VALID);
  });

  it("a stream with no text events: the narration is voiced once the sketch is in, as before", async () => {
    const message = reply(VALID);
    claude.current = {
      calls: [],
      stream: () => ({ finalMessage: async () => message }),
    };
    const res = await post(fresh);
    expect(res.status).toBe(200);
    expect(voice.narrated).toEqual([VALID.narration]);
  });

  it("rejected, then a retry with a new narration: both are voiced, and the answer is the retry's", async () => {
    quietLogs();
    script(reply(OFF_AREA), reply(VALID));
    const res = await post(fresh);
    expect(res.status).toBe(200);
    expect(voice.narrated).toEqual([OFF_AREA.narration, VALID.narration]);
    const body = SketchResponse.parse(await res.json());
    expect(body.sketch).toEqual(VALID);
    const record: unknown = JSON.parse(
      await readFile(
        path.join(
          voice.runs,
          LESSON,
          ANSWERS_DIR,
          path.basename(body.audioUrl).replace(/\.mp3$/, ".json"),
        ),
        "utf8",
      ),
    );
    expect(record).toMatchObject({ sketch: { narration: VALID.narration } });
  });

  it("rejected, then a retry with the same narration: voiced once, and its voicing reused", async () => {
    quietLogs();
    script(reply({ ...OFF_AREA, narration: VALID.narration }), reply(VALID));
    const res = await post(fresh);
    expect(res.status).toBe(200);
    expect(voice.narrated).toEqual([VALID.narration]);
  });

  it("a rejected attempt's voicing fails: the retry's narration is voiced, 200", async () => {
    quietLogs();
    voice.failing.add(OFF_AREA.narration);
    script(reply(OFF_AREA), reply(VALID));
    const res = await post(fresh);
    expect(res.status).toBe(200);
    expect(SketchResponse.parse(await res.json()).sketch).toEqual(VALID);
  });

  it("a rejected attempt's voicing fails once, and the retry keeps its narration: voiced again, 200", async () => {
    quietLogs();
    voice.failingOnce.add(VALID.narration);
    script(reply({ ...OFF_AREA, narration: VALID.narration }), reply(VALID));
    const res = await post(fresh);
    expect(res.status).toBe(200);
    expect(voice.narrated).toEqual([VALID.narration, VALID.narration]);
  });

  it("the voicing of the narration used fails: 502 Couldn't draw that, logged", async () => {
    const logs = quietLogs();
    voice.failing.add(VALID.narration);
    script(reply(VALID));
    await expectFailed(await post(fresh), 502);
    expect(logs.logged()).toContain(`voicing failed: ${VALID.narration}`);
  });

  it("rejected twice after both narrations were voiced: 502 Couldn't draw that for the sketch, not the voicing, nothing saved", async () => {
    const logs = quietLogs();
    voice.failing.add(OFF_AREA.narration);
    script(reply(OFF_AREA), reply({ ...OFF_AREA, narration: "[[c]]Again." }));
    await expectFailed(await post(fresh), 502);
    expect(voice.narrated).toEqual([OFF_AREA.narration, "[[c]]Again."]);
    expect(logs.logged()).toContain("rejected twice");
    expect(logs.logged()).not.toContain("voicing failed");
    await expect(
      readdir(path.join(voice.runs, LESSON, ANSWERS_DIR)),
    ).rejects.toThrow();
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
      "a lessonId that isn't one (#105: it names the run folder)",
      { description: "x", board: BOARD, lessonId: "../etc" },
    ],
    ["a null lessonId", { description: "x", board: BOARD, lessonId: null }],
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
    script(reply({ narration: SAID, objects: [], actions: [] }));
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
