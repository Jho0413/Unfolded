// POST /api/lessons/<lessonId>/steps/<n> (ROADMAP G2, ARCHITECTURE.md sections 5.1, 6.2 and 7).
// One test per cell of the section 6.2 table except the A1 ones, named "<state> x <event>", run
// through the route, plus the route's rejections (a bad lessonId or n). Nothing real is called:
// Claude is lib/fakes/claude.ts (scripted per test) and TTS is its FAKE_APIS=1 fake, and runs go
// to a temp runs dir.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/lessons/[lessonId]/steps/[n]/route";
import { STEP_ROUTE_ERRORS } from "@/app/api/lessons/[lessonId]/steps/[n]/errors";
import { config } from "@/lib/config";
import { resetEnvForTests } from "@/lib/env";
import { readFixture } from "@/lib/fakes";
import {
  type FakeClaude,
  fakeClaude,
  fakeMessage,
  type FakeReply,
} from "@/lib/fakes/claude";
import { NoAlignmentError, stripMarkers } from "@/lib/narration/cues";
import { TtsError } from "@/lib/narration/tts";
import type { SavedPaper } from "@/lib/pipeline/plan";
import {
  PAPER_FILE,
  PLAN_FILE,
  readRunJson,
  saveStepVersion,
  writeRunJson,
} from "@/lib/runs/store";
import {
  ApiError,
  type LessonPlan,
  SavedStep,
  StepResponse,
} from "@/shared/lesson";
import { Step } from "@/shared/scene";

// The Claude the step generator gets, the TTS failure a test forces, and a temp runs dir.
const state = vi.hoisted(() => ({
  messages: undefined as FakeClaude | undefined,
  ttsError: undefined as Error | undefined,
  runs: "",
}));
vi.mock("@/lib/pipeline/generate", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/pipeline/generate")>();
  return {
    ...real,
    claudeMessages: (fixture: string) =>
      state.messages ?? real.claudeMessages(fixture),
  };
});
vi.mock("@/lib/narration/tts", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/narration/tts")>();
  return {
    ...real,
    narrate: (...args: Parameters<typeof real.narrate>) =>
      state.ttsError ? Promise.reject(state.ttsError) : real.narrate(...args),
  };
});
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
const PAPER: SavedPaper = { fileId: "file_test123", filename: "paper.pdf" };
const PLAN: LessonPlan = {
  title: "A lesson",
  coverPrompt: "a cover",
  steps: [
    { title: "First idea", goal: "Introduce the first idea." },
    { title: "Second idea", goal: "Build the second idea on the first." },
  ],
};

/** The recorded step response (FAKE_APIS=1's fixture): a valid step. */
let validReply: Anthropic.Message;
/** Valid JSON that the wire schema rejects. */
const invalidReply = () => fakeMessage(JSON.stringify({ title: "x" }));

function script(...replies: FakeReply[]): FakeClaude {
  state.messages = fakeClaude(replies);
  return state.messages;
}

/**
 * A Claude whose answers wait for `release()`, so a test can send a second request while the
 * first is generating.
 */
function gatedClaude(...replies: FakeReply[]) {
  const inner = fakeClaude(replies);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let started!: () => void;
  const firstCall = new Promise<void>((resolve) => (started = resolve));
  state.messages = {
    calls: inner.calls,
    stream(body, options) {
      const answer = inner.stream(body, options);
      started();
      return { finalMessage: () => gate.then(() => answer.finalMessage()) };
    },
  };
  return { claude: inner, release, firstCall };
}

function post(lessonId: string, n: string): Promise<Response> {
  const req = new NextRequest(
    `http://localhost/api/lessons/${lessonId}/steps/${n}`,
    { method: "POST" },
  );
  return POST(req, { params: Promise.resolve({ lessonId, n }) });
}

function quietLogs() {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  return {
    logged: () =>
      error.mock.calls
        .flat()
        .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : a))
        .join(" "),
  };
}

async function expectError(res: Response, status: number, error: string) {
  expect(res.status).toBe(status);
  expect(ApiError.parse(await res.json())).toEqual({ error });
}

const stepFiles = async () =>
  (await readdir(path.join(state.runs, LESSON)))
    .filter((f) => f.startsWith("step-"))
    .sort();

beforeEach(async () => {
  state.runs = await mkdtemp(path.join(tmpdir(), "g2-runs-"));
  vi.stubEnv("FAKE_APIS", "1");
  resetEnvForTests();
  validReply = await readFixture<Anthropic.Message>(config.step.fixture);
  await writeRunJson(LESSON, PAPER_FILE, PAPER);
  await writeRunJson(LESSON, PLAN_FILE, PLAN);
});
afterEach(async () => {
  state.messages = undefined;
  state.ttsError = undefined;
  await rm(state.runs, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe("section 6.2: notRequested", () => {
  it("notRequested x request: -> generating; the step is written, narrated and saved as v1, 200 with its StepResponse", async () => {
    const claude = script(validReply);
    const res = await post(LESSON, "0");
    expect(res.status).toBe(200);
    const body = StepResponse.parse(await res.json());
    expect(body.version).toBe(1);
    expect(body.audioUrl).toBe(`/api/runs/${LESSON}/step-0.v1.mp3`);
    expect(Object.keys(body.cueTimes).length).toBeGreaterThan(0);

    // One request, with the lesson's paper by its file id and step 0's goal.
    expect(claude.calls).toHaveLength(1);
    const content = claude.calls[0].body.messages[0].content;
    expect(Array.isArray(content) && content[0]).toMatchObject({
      source: { type: "file", file_id: PAPER.fileId },
    });
    expect(JSON.stringify(content)).toContain(PLAN.steps[0].goal);

    // Saved as SavedStep with its audio, exactly what the route answered.
    expect(await stepFiles()).toEqual(["step-0.v1.json", "step-0.v1.mp3"]);
    const saved = await readRunJson(LESSON, "step-0.v1.json", SavedStep);
    expect(saved).toEqual({ step: body.step, cueTimes: body.cueTimes });
  });

  it("notRequested x request for step n > 0: the previous step's saved narration goes to Claude", async () => {
    const previous = Step.parse(await readFixture("demo-m1.step.json"));
    await saveStepVersion(
      LESSON,
      0,
      { step: previous, cueTimes: {} },
      new Uint8Array([1]),
    );
    const claude = script(validReply);
    const res = await post(LESSON, "1");
    expect(res.status).toBe(200);
    // The prompt gets the narration as spoken, markers stripped.
    const sent = claude.calls[0].body.messages[0].content;
    expect(JSON.stringify(sent)).toContain(
      JSON.stringify(stripMarkers(previous.narration).text).slice(1, -1),
    );
    expect(StepResponse.parse(await res.json()).audioUrl).toBe(
      `/api/runs/${LESSON}/step-1.v1.mp3`,
    );
  });
});

describe("section 6.2: generating", () => {
  it("generating x request: waits for this generation (no second one), and both get the same step", async () => {
    const { claude, release, firstCall } = gatedClaude(validReply);
    const first = post(LESSON, "0");
    await firstCall;
    const second = post(LESSON, "0");
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
    expect(claude.calls).toHaveLength(1);
    expect(await stepFiles()).toEqual(["step-0.v1.json", "step-0.v1.mp3"]);
  });

  it("generating x request, two at once before either reads the run: still one generation", async () => {
    const claude = script(validReply);
    const [a, b] = await Promise.all([post(LESSON, "0"), post(LESSON, "0")]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(claude.calls).toHaveLength(1);
  });

  it("generating x request for another step: generates that step on its own", async () => {
    const claude = script(validReply, validReply);
    const [a, b] = await Promise.all([post(LESSON, "0"), post(LESSON, "1")]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(claude.calls).toHaveLength(2);
  });

  it("generating x rejected, first time: retried with the errors, then -> ready", async () => {
    quietLogs();
    const claude = script(invalidReply(), validReply);
    const res = await post(LESSON, "0");
    expect(res.status).toBe(200);
    expect(claude.calls).toHaveLength(2);
    expect(JSON.stringify(claude.calls[1].body.messages.at(-1))).toContain(
      "narration",
    );
    expect(await stepFiles()).toEqual(["step-0.v1.json", "step-0.v1.mp3"]);
  });

  it('generating x rejected, second time: -> failed, 502 "Couldn\'t make this step.", logged with lesson and step, nothing saved', async () => {
    const logs = quietLogs();
    script(invalidReply(), invalidReply());
    await expectError(await post(LESSON, "0"), 502, STEP_ROUTE_ERRORS.failed);
    expect(logs.logged()).toContain(
      `[api/lessons/steps] ${LESSON} step 0: failed (rejected)`,
    );
    expect(logs.logged()).toContain("rejected twice");
    expect(await stepFiles()).toEqual([]);
  });

  it("generating x valid + audio + cues: -> ready (200, saved)", async () => {
    script(validReply);
    const res = await post(LESSON, "0");
    expect(res.status).toBe(200);
    expect(await stepFiles()).toEqual(["step-0.v1.json", "step-0.v1.mp3"]);
  });

  it("generating x refusal: -> failed (502), logged", async () => {
    const logs = quietLogs();
    script(fakeMessage("", "refusal"));
    await expectError(await post(LESSON, "0"), 502, STEP_ROUTE_ERRORS.failed);
    expect(logs.logged()).toContain("failed (claudeFailed)");
    expect(logs.logged()).toContain("declined");
  });

  it("generating x Claude error after SDK retries: -> failed (502), logged", async () => {
    const logs = quietLogs();
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    script(new Anthropic.APIConnectionError({ message: "socket hang up" }));
    await expectError(await post(LESSON, "0"), 502, STEP_ROUTE_ERRORS.failed);
    expect(logs.logged()).toContain("failed (claudeFailed)");
    expect(await stepFiles()).toEqual([]);
  });

  it("generating x max_tokens cut-off: -> failed (502), logged", async () => {
    const logs = quietLogs();
    script(fakeMessage("{", "max_tokens"));
    await expectError(await post(LESSON, "0"), 502, STEP_ROUTE_ERRORS.failed);
    expect(logs.logged()).toContain("cut off");
  });

  it("generating x TTS error: -> failed (502), logged, nothing saved", async () => {
    const logs = quietLogs();
    script(validReply);
    state.ttsError = new TtsError("provider", "ElevenLabs TTS returned 500");
    await expectError(await post(LESSON, "0"), 502, STEP_ROUTE_ERRORS.failed);
    expect(logs.logged()).toContain("failed (ttsFailed)");
    expect(logs.logged()).toContain("ElevenLabs TTS returned 500");
    expect(await stepFiles()).toEqual([]);
  });

  it("generating x quota error: -> failed (502)", async () => {
    quietLogs();
    script(validReply);
    state.ttsError = new TtsError("quota", "ElevenLabs TTS returned 429");
    await expectError(await post(LESSON, "0"), 502, STEP_ROUTE_ERRORS.failed);
  });

  it("generating x no alignment: -> failed (502)", async () => {
    const logs = quietLogs();
    script(validReply);
    state.ttsError = new NoAlignmentError("text", null, "alignment is null");
    await expectError(await post(LESSON, "0"), 502, STEP_ROUTE_ERRORS.failed);
    expect(logs.logged()).toContain("failed (ttsFailed)");
  });

  it("a request waiting on a generation that fails gets the same failure", async () => {
    quietLogs();
    const { claude, release, firstCall } = gatedClaude(
      fakeMessage("", "refusal"),
    );
    const first = post(LESSON, "0");
    await firstCall;
    const second = post(LESSON, "0");
    release();
    for (const res of await Promise.all([first, second]))
      await expectError(res, 502, STEP_ROUTE_ERRORS.failed);
    expect(claude.calls).toHaveLength(1);
  });
});

describe("section 6.2: ready", () => {
  it("ready x request: returns it from runs/ (the latest version), with no provider call", async () => {
    const step = Step.parse(await readFixture("demo-m1.step.json"));
    const cueTimes = Object.fromEntries(
      step.actions.map((a, i) => [a.cue, i * 100]),
    );
    await saveStepVersion(LESSON, 0, { step, cueTimes }, new Uint8Array([1]));
    await saveStepVersion(LESSON, 0, { step, cueTimes }, new Uint8Array([2]));
    const claude = script();
    state.ttsError = new Error("TTS must not be called");

    const res = await post(LESSON, "0");
    expect(res.status).toBe(200);
    expect(StepResponse.parse(await res.json())).toEqual({
      step,
      cueTimes,
      version: 2,
      audioUrl: `/api/runs/${LESSON}/step-0.v2.mp3`,
    });
    expect(claude.calls).toHaveLength(0);
  });

  it("ready x request after generating: the second request is served, not generated", async () => {
    const claude = script(validReply);
    const first = await post(LESSON, "0");
    const second = await post(LESSON, "0");
    expect(await second.json()).toEqual(await first.json());
    expect(claude.calls).toHaveLength(1);
  });
});

describe("section 6.2: failed", () => {
  it("failed x request: -> generating; a new request after a failure generates it again (the player's Retry)", async () => {
    const logs = quietLogs();
    const claude = script(fakeMessage("", "refusal"), validReply);
    await expectError(await post(LESSON, "0"), 502, STEP_ROUTE_ERRORS.failed);
    const retry = await post(LESSON, "0");
    expect(retry.status).toBe(200);
    expect(StepResponse.parse(await retry.json()).version).toBe(1);
    expect(claude.calls).toHaveLength(2);
    expect(vi.mocked(console.info).mock.calls.flat().join(" ")).toContain(
      `${LESSON} step 0: generating again after a failure`,
    );
    expect(logs.logged()).toContain("failed (claudeFailed)");
  });

  it("failed x request after a TTS failure: generates again once TTS is back", async () => {
    quietLogs();
    const claude = script(validReply, validReply);
    state.ttsError = new TtsError("quota", "429");
    await expectError(await post(LESSON, "0"), 502, STEP_ROUTE_ERRORS.failed);
    state.ttsError = undefined;
    expect((await post(LESSON, "0")).status).toBe(200);
    expect(claude.calls).toHaveLength(2);
  });
});

describe("failures outside the table", () => {
  it('a lesson with a plan but no paper.json: 500 "Couldn\'t make this step.", logged, Claude not called', async () => {
    const logs = quietLogs();
    await rm(path.join(state.runs, LESSON, PAPER_FILE));
    const claude = script();
    await expectError(await post(LESSON, "0"), 500, STEP_ROUTE_ERRORS.failed);
    expect(logs.logged()).toContain("failed (internal)");
    expect(logs.logged()).toContain("paper.json");
    expect(claude.calls).toHaveLength(0);
  });

  it("a plan.json that isn't a plan: 500, logged", async () => {
    const logs = quietLogs();
    await writeRunJson(LESSON, PLAN_FILE, { title: "no steps" });
    await expectError(await post(LESSON, "0"), 500, STEP_ROUTE_ERRORS.failed);
    expect(logs.logged()).toContain(`${LESSON} step 0: failed (internal)`);
  });
});

describe('route: "No such lesson or step."', () => {
  it("bad lessonId -> 400 (not ^[a-z0-9-]{1,40}$, or traversal), not logged", async () => {
    const logs = quietLogs();
    const claude = script();
    for (const id of ["", "Lesson", "a_b", "a".repeat(41), "..", "../x"])
      await expectError(await post(id, "0"), 400, STEP_ROUTE_ERRORS.noSuchStep);
    expect(logs.logged()).toBe("");
    expect(claude.calls).toHaveLength(0);
  });

  it("n that isn't a step number -> 400", async () => {
    const claude = script();
    for (const n of ["-1", "01", "1.0", "1e1", "x", "", " 1", "0x1", "12"])
      await expectError(
        await post(LESSON, n),
        400,
        STEP_ROUTE_ERRORS.noSuchStep,
      );
    expect(claude.calls).toHaveLength(0);
  });

  it("n past the plan's last step -> 400", async () => {
    const claude = script();
    await expectError(
      await post(LESSON, "2"),
      400,
      STEP_ROUTE_ERRORS.noSuchStep,
    );
    expect(claude.calls).toHaveLength(0);
  });

  it("a lesson with no plan.json -> 404", async () => {
    const claude = script();
    await expectError(
      await post("no-such-lesson", "0"),
      404,
      STEP_ROUTE_ERRORS.noSuchStep,
    );
    expect(claude.calls).toHaveLength(0);
  });

  it("the words are ARCHITECTURE.md section 7's", () => {
    expect(STEP_ROUTE_ERRORS).toEqual({
      noSuchStep: "No such lesson or step.",
      failed: "Couldn't make this step.",
    });
  });
});
