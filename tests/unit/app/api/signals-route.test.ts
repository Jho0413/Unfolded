// POST /api/lessons/<lessonId>/signals (ROADMAP A1, ARCHITECTURE.md sections 5.4 and 7): one
// test per row of the signals table, through the route, with runs in a temp dir.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/lessons/[lessonId]/signals/route";
import { SIGNAL_ROUTE_ERRORS } from "@/app/api/lessons/[lessonId]/signals/errors";
import { config } from "@/lib/config";
import {
  PLAN_FILE,
  readSignals,
  SIGNALS_FILE,
  writeRunFile,
  writeRunJson,
} from "@/lib/runs/store";
import {
  ApiError,
  EMPTY_SIGNALS,
  type LessonPlan,
  SignalResponse,
  SignalsFile,
} from "@/shared/lesson";

const state = vi.hoisted(() => ({ runs: "" }));
vi.mock("@/lib/config", async (importOriginal) => {
  const { config } = await importOriginal<typeof import("@/lib/config")>();
  return {
    config: {
      ...config,
      get runsDir() {
        return state.runs;
      },
    },
  };
});

const LESSON = "lesson-1";
const PLAN: LessonPlan = {
  title: "A lesson",
  coverPrompt: "a cover",
  steps: [{ title: "First idea", goal: "Introduce the first idea." }],
};

function post(lessonId: string, body: unknown): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/lessons/${lessonId}/signals`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ lessonId }) },
  );
}

async function expectVersion(res: Response, version: number) {
  expect(res.status).toBe(200);
  expect(SignalResponse.parse(await res.json())).toEqual({ version });
}

async function expectError(res: Response, status: number, error: string) {
  expect(res.status).toBe(status);
  expect(ApiError.parse(await res.json())).toEqual({ error });
}

beforeEach(async () => {
  state.runs = await mkdtemp(path.join(tmpdir(), "a1-signals-"));
  await writeRunJson(LESSON, PLAN_FILE, PLAN);
});
afterEach(async () => {
  await rm(state.runs, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("signal recorded", () => {
  it("a question: appended to signals.json with the server's time, 200 { version: 1 }", async () => {
    const before = Date.now();
    await expectVersion(
      await post(LESSON, {
        question: "why divide by root d?",
        step: 0,
        t: 1200,
      }),
      1,
    );
    const file = await readSignals(LESSON);
    expect(file.version).toBe(1);
    expect(file.signals).toHaveLength(1);
    const [recorded] = file.signals;
    expect(recorded).toMatchObject({
      question: "why divide by root d?",
      step: 0,
      t: 1200,
    });
    const at = Date.parse(recorded.at);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("a simplify request bumps the version; a started signal is recorded but doesn't", async () => {
    await expectVersion(await post(LESSON, { question: "why?" }), 1);
    await expectVersion(
      await post(LESSON, { simplify: "too fast", step: 0 }),
      2,
    );
    await expectVersion(await post(LESSON, { started: 0, version: 1 }), 2);
    const file = await readSignals(LESSON);
    expect(file.version).toBe(2);
    expect(file.signals.map((s) => Object.keys(s)[0])).toEqual([
      "question",
      "simplify",
      "started",
    ]);
  });

  it("signals.json is written whole (no temporary file left behind) and parses as a SignalsFile", async () => {
    await post(LESSON, { question: "why?" });
    const files = await readdir(path.join(state.runs, LESSON));
    expect(files.sort()).toEqual([PLAN_FILE, SIGNALS_FILE].sort());
    expect(SignalsFile.safeParse(await readSignals(LESSON)).success).toBe(true);
  });
});

it("a question of exactly maxSignalChars is recorded", async () => {
  await expectVersion(
    await post(LESSON, { question: "x".repeat(config.maxSignalChars) }),
    1,
  );
});

describe("concurrent posts", () => {
  it("both recorded: two signals at once both land, versions 1 and 2", async () => {
    const [a, b] = await Promise.all([
      post(LESSON, { question: "first?" }),
      post(LESSON, { question: "second?" }),
    ]);
    const versions = [
      SignalResponse.parse(await a.json()).version,
      SignalResponse.parse(await b.json()).version,
    ].sort();
    expect(versions).toEqual([1, 2]);
    const file = await readSignals(LESSON);
    expect(file.version).toBe(2);
    expect(
      file.signals.map((s) => ("question" in s ? s.question : "")).sort(),
    ).toEqual(["first?", "second?"]);
  });

  it("many at once, across two lessons: every one recorded in its own lesson", async () => {
    await writeRunJson("lesson-2", PLAN_FILE, PLAN);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        post(i % 2 ? LESSON : "lesson-2", { question: `q${i}` }),
      ),
    );
    expect((await readSignals(LESSON)).version).toBe(5);
    expect((await readSignals("lesson-2")).version).toBe(5);
  });
});

describe("missing file", () => {
  it("reads as version 0 with no signals (EMPTY_SIGNALS)", async () => {
    expect(await readSignals(LESSON)).toEqual(EMPTY_SIGNALS);
    expect(EMPTY_SIGNALS).toEqual({ version: 0, signals: [] });
  });
});

describe('bad body rejected: 400 "That isn\'t a learner signal.", nothing recorded', () => {
  const bad: [string, unknown][] = [
    ["not JSON", "{"],
    ["empty object", {}],
    ["empty question", { question: "" }],
    ["unknown key (strict)", { question: "why?", extra: 1 }],
    ["two kinds at once", { question: "why?", simplify: "x" }],
    ["negative step", { question: "why?", step: -1 }],
    ["fractional step", { question: "why?", step: 0.5 }],
    ["negative t", { simplify: "x", t: -1 }],
    ["started without a version", { started: 0 }],
    ["started version 0", { started: 0, version: 0 }],
    ["started with step and t", { started: 0, version: 1, step: 0 }],
    ["a client-sent `at`", { question: "why?", at: "2026-01-01T00:00:00Z" }],
    ["an array", [{ question: "why?" }]],
    [
      "a question over maxSignalChars",
      { question: "x".repeat(config.maxSignalChars + 1) },
    ],
    [
      "a simplify reason over maxSignalChars",
      { simplify: "x".repeat(config.maxSignalChars + 1) },
    ],
    ["null", null],
  ];
  for (const [name, body] of bad)
    it(name, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await expectError(
        await post(LESSON, body),
        400,
        SIGNAL_ROUTE_ERRORS.badSignal,
      );
      expect(await readSignals(LESSON)).toEqual(EMPTY_SIGNALS);
    });
});

describe('unknown lesson rejected: "No such lesson or step."', () => {
  it("a lesson with no plan.json -> 404, and no folder is made for it", async () => {
    await expectError(
      await post("no-such-lesson", { question: "why?" }),
      404,
      SIGNAL_ROUTE_ERRORS.noSuchLesson,
    );
    expect(await readdir(state.runs)).toEqual([LESSON]);
  });

  it("a bad lessonId -> 400, not logged", async () => {
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    for (const id of ["", "Lesson", "a_b", "a".repeat(41), "..", "../x"])
      await expectError(
        await post(id, { question: "why?" }),
        400,
        SIGNAL_ROUTE_ERRORS.noSuchLesson,
      );
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("a damaged signals.json", () => {
  it("500, logged, and the file is left as it was (never overwritten)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await writeRunFile(LESSON, SIGNALS_FILE, "{ not json");
    await expectError(
      await post(LESSON, { question: "why?" }),
      500,
      SIGNAL_ROUTE_ERRORS.failed,
    );
    expect(error.mock.calls.flat().join(" ")).toContain(
      `[api/lessons/signals] ${LESSON}: failed to record a signal`,
    );
    const { readFile } = await import("node:fs/promises");
    expect(
      await readFile(path.join(state.runs, LESSON, SIGNALS_FILE), "utf8"),
    ).toBe("{ not json");
  });

  it("an append after a failed one still runs (the lesson's queue isn't stuck)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await writeRunFile(LESSON, SIGNALS_FILE, "{ not json");
    // Both queued behind each other: the first fails, the second still runs (and fails too).
    const [a, b] = await Promise.all([
      post(LESSON, { question: "first?" }),
      post(LESSON, { question: "second?" }),
    ]);
    expect([a.status, b.status]).toEqual([500, 500]);
    await writeRunJson(LESSON, SIGNALS_FILE, EMPTY_SIGNALS);
    await expectVersion(await post(LESSON, { question: "third?" }), 1);
  });
});

it("the words are ARCHITECTURE.md section 7's", () => {
  expect(SIGNAL_ROUTE_ERRORS).toEqual({
    noSuchLesson: "No such lesson or step.",
    badSignal: "That isn't a learner signal.",
    failed: "Couldn't record that signal.",
  });
});
