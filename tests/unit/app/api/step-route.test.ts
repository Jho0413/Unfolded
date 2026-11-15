// POST /api/lessons/<lessonId>/steps/<n> (ROADMAP G2 and A1, ARCHITECTURE.md sections 5.1, 5.4,
// 6.2 and 7). One test per cell of the section 6.2 table except the A1 ones, named "<state> x
// <event>", run through the route, plus the route's rejections (a bad lessonId or n), and one
// test per row of adaptation's table (A1, section 5.4) with the A1 cells it covers. Nothing real is called:
// Claude is lib/fakes/claude.ts (scripted per test) and TTS is its FAKE_APIS=1 fake, and runs go
// to a temp runs dir. One test per row of #152's table (E1, the step's images): fal is
// lib/fakes/fal.ts, scripted per test.
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
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
import { resetStepRequestsForTests } from "@/lib/pipeline/lessonStep";
import { type FakeImages, fakeImages } from "@/lib/fakes/fal";
import {
  type FakeClaude,
  fakeClaude,
  fakeMessage,
  type FakeReply,
} from "@/lib/fakes/claude";
import { NoAlignmentError, stripMarkers } from "@/lib/narration/cues";
import { TtsError } from "@/lib/narration/tts";
import { PaperText } from "@/lib/pipeline/paperPages";
import type { SavedPaper } from "@/lib/pipeline/plan";
import { paperContextPrompt } from "@/lib/pipeline/prompts/paper";
import {
  appendSignal,
  PAPER_FILE,
  PAPER_PDF_FILE,
  PAPER_TEXT_FILE,
  PLAN_FILE,
  readRunJson,
  saveStepVersion,
  SIGNALS_FILE,
  writeRunFile,
  writeRunJson,
} from "@/lib/runs/store";
import {
  ApiError,
  STEP_NOT_IN_RUN,
  type LessonPlan,
  SavedStep,
  StepResponse,
} from "@/shared/lesson";
import { type CuedPaperRef, Step } from "@/shared/scene";
import { PAPER_PAGES, paperPdf } from "../../../e2e/support/paperPdf";

// The Claude the step generator gets, the TTS failure a test forces, and a temp runs dir.
const state = vi.hoisted(() => ({
  messages: undefined as FakeClaude | undefined,
  ttsError: undefined as Error | undefined,
  ttsCalls: 0,
  runs: "",
  /** The step images' fal (E1): a scripted fake, or none (as with no FAL_KEY). */
  images: undefined as FakeImages | undefined,
  /** config.stepImages.timeoutMs, when a test shortens it. */
  imageTimeoutMs: undefined as number | undefined,
}));
vi.mock("@/lib/media/fal", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/media/fal")>();
  return { ...real, falImages: () => state.images };
});
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
    narrate: (...args: Parameters<typeof real.narrate>) => {
      state.ttsCalls++;
      return state.ttsError
        ? Promise.reject(state.ttsError)
        : real.narrate(...args);
    },
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
      get stepImages() {
        return {
          ...config.stepImages,
          timeoutMs: state.imageTimeoutMs ?? config.stepImages.timeoutMs,
        };
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
  // Each test starts with no generation running and no failure remembered.
  resetStepRequestsForTests();
  state.messages = undefined;
  state.ttsError = undefined;
  state.ttsCalls = 0;
  state.images = undefined;
  state.imageTimeoutMs = undefined;
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
    // With no signals.json, the generation used signals version 0, and adapted to nothing.
    expect(saved).toEqual({
      step: body.step,
      cueTimes: body.cueTimes,
      signalsVersion: 0,
    });
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
  it("ready x request, but the newest saved file isn't a SavedStep: logged, and a new version is generated", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeRunJson(LESSON, "step-0.v1.json", { step: "damaged" });
    const claude = script(validReply);
    const res = await post(LESSON, "0");
    expect(res.status).toBe(200);
    expect(StepResponse.parse(await res.json()).version).toBe(2);
    expect(claude.calls).toHaveLength(1);
    expect(warn.mock.calls.flat().join(" ")).toContain(
      `${LESSON}/step-0.v1.json is not a saved step`,
    );
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

describe("paper quotes (#98), through the route", () => {
  /** The recorded step with quotes from the e2e paper fixture (./paperPdf), cued on its [[row0]]. */
  async function replyQuoting(...paperRefs: CuedPaperRef[]) {
    const text = validReply.content.find((b) => b.type === "text");
    const step = { ...JSON.parse(text!.text), paperRefs };
    return fakeMessage(JSON.stringify(step));
  }
  const FOUND: CuedPaperRef = {
    page: 2,
    quote: "The products of the paired entries are added together",
    cue: "row0",
  };

  it("a run with paper.pdf: the quotes are checked against its text, and the step is saved with them", async () => {
    await writeRunFile(LESSON, PAPER_PDF_FILE, new Uint8Array(paperPdf()));
    const claude = script(await replyQuoting(FOUND));
    const res = await post(LESSON, "0");
    expect(res.status).toBe(200);
    expect(claude.calls).toHaveLength(1);
    expect(JSON.stringify(claude.calls[0].body.messages[0].content)).toContain(
      paperContextPrompt(PAPER_PAGES.length),
    );
    const saved = await readRunJson(LESSON, "step-0.v1.json", SavedStep);
    expect(saved?.step.paperRefs).toEqual([FOUND]);
    // The page text is kept for the next step.
    const cached = await readRunJson(LESSON, PAPER_TEXT_FILE, PaperText);
    expect(cached?.pages).toHaveLength(PAPER_PAGES.length);
  });

  it("no paper.pdf: no quotes asked for, and the step is saved without any", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const claude = script(await replyQuoting(FOUND));
    expect((await post(LESSON, "0")).status).toBe(200);
    expect(claude.calls).toHaveLength(1);
    expect(JSON.stringify(claude.calls[0].body.messages[0].content)).toContain(
      paperContextPrompt(undefined),
    );
    const saved = await readRunJson(LESSON, "step-0.v1.json", SavedStep);
    expect(saved?.step).not.toHaveProperty("paperRefs");
  });

  it("PDF text extraction fails: the step is saved without paperRefs, with a log line", async () => {
    const logs = quietLogs();
    await writeRunFile(
      LESSON,
      PAPER_PDF_FILE,
      new TextEncoder().encode("%PDF-1.7 not really"),
    );
    const claude = script(await replyQuoting(FOUND));
    expect((await post(LESSON, "0")).status).toBe(200);
    expect(claude.calls).toHaveLength(1);
    const saved = await readRunJson(LESSON, "step-0.v1.json", SavedStep);
    expect(saved?.step).not.toHaveProperty("paperRefs");
    expect(logs.logged()).toContain(
      `${LESSON}: couldn't extract the text of ${PAPER_PDF_FILE}`,
    );
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
      notInRun: "This step isn't in the saved run.",
      failed: "Couldn't make this step.",
    });
  });
});

describe("replay mode (REPLAY_RUN): the saved run only, no provider call", () => {
  /** REPLAY_RUN wins over FAKE_APIS (lib/env.ts), so no fake may be called either. */
  function replay() {
    vi.stubEnv("REPLAY_RUN", LESSON);
    resetEnvForTests();
    return script();
  }
  async function saveStep(n: number, bytes: number[]) {
    const step = Step.parse(await readFixture("demo-m1.step.json"));
    await saveStepVersion(
      LESSON,
      n,
      { step, cueTimes: {} },
      new Uint8Array(bytes),
    );
    return step;
  }

  it("a saved step is served as its latest version, with no fake called", async () => {
    const step = await saveStep(0, [1]);
    await saveStep(0, [2]);
    const claude = replay();
    const res = await post(LESSON, "0");
    expect(res.status).toBe(200);
    expect(StepResponse.parse(await res.json())).toEqual({
      step,
      cueTimes: {},
      version: 2,
      audioUrl: `/api/runs/${LESSON}/step-0.v2.mp3`,
    });
    expect(claude.calls).toHaveLength(0);
    expect(state.ttsCalls).toBe(0);
  });

  it('a missing step -> 404 "This step isn\'t in the saved run.", on every request, and nothing is generated', async () => {
    const claude = replay();
    for (let i = 0; i < 2; i++)
      await expectError(await post(LESSON, "1"), 404, STEP_NOT_IN_RUN);
    expect(STEP_ROUTE_ERRORS.notInRun).toBe(
      "This step isn't in the saved run.",
    );
    expect(claude.calls).toHaveLength(0);
    expect(state.ttsCalls).toBe(0);
    expect(await stepFiles()).toEqual([]);
  });

  it("a step whose saved file is damaged is not in the run (404), not regenerated", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeRunJson(LESSON, "step-0.v1.json", { step: "damaged" });
    const claude = replay();
    await expectError(await post(LESSON, "0"), 404, STEP_NOT_IN_RUN);
    expect(claude.calls).toHaveLength(0);
    expect(state.ttsCalls).toBe(0);
  });

  it("n past the plan -> 400, and a lesson with no plan -> 404 'No such lesson or step.'", async () => {
    const claude = replay();
    await expectError(
      await post(LESSON, "2"),
      400,
      STEP_ROUTE_ERRORS.noSuchStep,
    );
    await expectError(
      await post("other-lesson", "0"),
      404,
      STEP_ROUTE_ERRORS.noSuchStep,
    );
    expect(claude.calls).toHaveLength(0);
  });
});

describe("adaptation (A1, section 5.4): a question makes a step that hasn't started stale", () => {
  const QUESTION = { question: "why divide by root d?", step: 0, t: 1200 };

  /** Saves a version of step n made with signals version `signalsVersion` (absent: before A1). */
  async function saveVersion(n: number, signalsVersion?: number) {
    const step = Step.parse(await readFixture("demo-m1.step.json"));
    const saved: SavedStep = { step, cueTimes: {}, signalsVersion };
    const version = await saveStepVersion(
      LESSON,
      n,
      saved,
      new Uint8Array([1]),
    );
    return { saved, version };
  }
  const sentToClaude = (claude: FakeClaude, i = 0) =>
    JSON.stringify(claude.calls[i].body.messages[0].content);

  it("stale step regenerated with adaptedFrom: v2 with the question sent to Claude, signalsVersion and adaptedFrom saved", async () => {
    await saveVersion(1, 0);
    await appendSignal(LESSON, QUESTION);
    const claude = script(validReply);
    vi.spyOn(console, "info").mockImplementation(() => {});

    const res = await post(LESSON, "1");
    expect(res.status).toBe(200);
    const body = StepResponse.parse(await res.json());
    expect(body.version).toBe(2);
    expect(body.audioUrl).toBe(`/api/runs/${LESSON}/step-1.v2.mp3`);
    expect(body.signalsVersion).toBe(1);
    expect(body.adaptedFrom).toEqual({
      kind: "question",
      text: QUESTION.question,
      atStep: 0,
    });
    expect(claude.calls).toHaveLength(1);
    expect(sentToClaude(claude)).toContain(`- Asked: ${QUESTION.question}`);
    expect(sentToClaude(claude)).toContain("<learner_messages>");
    // Saved as the route answered it; v1 is kept, never overwritten.
    const saved = await readRunJson(LESSON, "step-1.v2.json", SavedStep);
    expect(saved).toMatchObject({
      signalsVersion: 1,
      adaptedFrom: body.adaptedFrom,
    });
    expect(await stepFiles()).toEqual([
      "step-1.v1.json",
      "step-1.v1.mp3",
      "step-1.v2.json",
      "step-1.v2.mp3",
    ]);
    // Once regenerated, the next request is served the new version.
    const again = StepResponse.parse(await (await post(LESSON, "1")).json());
    expect(again.version).toBe(2);
    expect(claude.calls).toHaveLength(1);
  });

  it("a step saved before signals existed (no signalsVersion) is stale once a question arrives", async () => {
    await saveVersion(1);
    await appendSignal(LESSON, QUESTION);
    script(validReply);
    vi.spyOn(console, "info").mockImplementation(() => {});
    const body = StepResponse.parse(await (await post(LESSON, "1")).json());
    expect(body.version).toBe(2);
    expect(body.adaptedFrom?.text).toBe(QUESTION.question);
  });

  it("several new questions: Claude gets only the ones the old version didn't see, adaptedFrom names the newest", async () => {
    await appendSignal(LESSON, { question: "an old question?", step: 0 });
    await saveVersion(1, 1);
    await appendSignal(LESSON, { question: "first new?", step: 0 });
    await appendSignal(LESSON, { started: 0, version: 1 });
    await appendSignal(LESSON, { simplify: "slower please", step: 0 });
    await appendSignal(LESSON, { question: "second new?", step: 0, t: 40 });
    const claude = script(validReply);
    vi.spyOn(console, "info").mockImplementation(() => {});

    const body = StepResponse.parse(await (await post(LESSON, "1")).json());
    expect(body.signalsVersion).toBe(4);
    expect(body.adaptedFrom).toEqual({
      kind: "question",
      text: "second new?",
      atStep: 0,
    });
    const sent = sentToClaude(claude);
    expect(sent).toContain("- Asked: first new?");
    expect(sent).toContain("- Asked to simplify: slower please");
    expect(sent).toContain("- Asked: second new?");
    expect(sent).not.toContain("an old question?");
  });

  it("a simplify request regenerates too, with adaptedFrom kind simplify", async () => {
    await saveVersion(1, 0);
    await appendSignal(LESSON, { simplify: "too fast", step: 0, t: 10 });
    script(validReply);
    vi.spyOn(console, "info").mockImplementation(() => {});
    const body = StepResponse.parse(await (await post(LESSON, "1")).json());
    expect(body.adaptedFrom).toEqual({
      kind: "simplify",
      text: "too fast",
      atStep: 0,
    });
  });

  it("not stale (same version): served as saved, no provider call", async () => {
    await appendSignal(LESSON, QUESTION);
    const { saved } = await saveVersion(1, 1);
    const claude = script();
    state.ttsError = new Error("TTS must not be called");
    const body = StepResponse.parse(await (await post(LESSON, "1")).json());
    expect(body).toEqual({
      ...saved,
      version: 1,
      audioUrl: `/api/runs/${LESSON}/step-1.v1.mp3`,
    });
    expect(claude.calls).toHaveLength(0);
  });

  it("a started signal alone makes nothing stale", async () => {
    await saveVersion(1, 0);
    await appendSignal(LESSON, { started: 0, version: 1 });
    const claude = script();
    expect(
      StepResponse.parse(await (await post(LESSON, "1")).json()).version,
    ).toBe(1);
    expect(claude.calls).toHaveLength(0);
  });

  it("a first version made with signals: they go to Claude and signalsVersion is saved, but no adaptedFrom (nothing replaced)", async () => {
    await appendSignal(LESSON, QUESTION);
    const claude = script(validReply);
    const body = StepResponse.parse(await (await post(LESSON, "1")).json());
    expect(body.version).toBe(1);
    expect(body.signalsVersion).toBe(1);
    expect(body.adaptedFrom).toBeUndefined();
    expect(sentToClaude(claude)).toContain(`- Asked: ${QUESTION.question}`);
    const saved = await readRunJson(LESSON, "step-1.v1.json", SavedStep);
    expect(saved).not.toHaveProperty("adaptedFrom");
  });

  it("a new version over a damaged newest file, with no newer signals: no adaptedFrom", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeRunJson(LESSON, "step-1.v1.json", { step: "damaged" });
    script(validReply);
    const body = StepResponse.parse(await (await post(LESSON, "1")).json());
    expect(body.version).toBe(2);
    expect(body.adaptedFrom).toBeUndefined();
  });

  it("started step never regenerated: after a newer question, the played version is served", async () => {
    await saveVersion(1, 0);
    await appendSignal(LESSON, { started: 1, version: 1 });
    await appendSignal(LESSON, QUESTION);
    const claude = script();
    const body = StepResponse.parse(await (await post(LESSON, "1")).json());
    expect(body.version).toBe(1);
    expect(claude.calls).toHaveLength(0);
    expect(await stepFiles()).toEqual(["step-1.v1.json", "step-1.v1.mp3"]);
  });

  it("started x request: the played version, not a newer one saved after it", async () => {
    await saveVersion(1, 0);
    await saveVersion(1, 0);
    await appendSignal(LESSON, { started: 1, version: 1 });
    const claude = script();
    const body = StepResponse.parse(await (await post(LESSON, "1")).json());
    expect(body.version).toBe(1);
    expect(body.audioUrl).toBe(`/api/runs/${LESSON}/step-1.v1.mp3`);
    expect(claude.calls).toHaveLength(0);
  });

  it("a played version whose file is missing: the latest is served, still never regenerated", async () => {
    await saveVersion(1, 0);
    await appendSignal(LESSON, { started: 1, version: 7 });
    await appendSignal(LESSON, QUESTION);
    const claude = script();
    const body = StepResponse.parse(await (await post(LESSON, "1")).json());
    expect(body.version).toBe(1);
    expect(claude.calls).toHaveLength(0);
  });

  it("generation failure keeps serving the old version: logged with the route's failure line, 200 with v1, and not retried until a newer signal", async () => {
    const logs = quietLogs();
    await saveVersion(1, 0);
    await appendSignal(LESSON, QUESTION);
    const claude = script(fakeMessage("", "refusal"), validReply);

    const res = await post(LESSON, "1");
    expect(res.status).toBe(200);
    expect(StepResponse.parse(await res.json()).version).toBe(1);
    expect(logs.logged()).toContain(
      `[api/lessons/steps] ${LESSON} step 1: failed (claudeFailed), keeping v1`,
    );
    expect(await stepFiles()).toEqual(["step-1.v1.json", "step-1.v1.mp3"]);

    // The kept version is ready: the next request is served it, with no new attempt.
    expect(
      StepResponse.parse(await (await post(LESSON, "1")).json()).version,
    ).toBe(1);
    expect(claude.calls).toHaveLength(1);

    // A newer signal makes it stale again; the regeneration gets both questions.
    await appendSignal(LESSON, { question: "and the softmax?", step: 0 });
    const body = StepResponse.parse(await (await post(LESSON, "1")).json());
    expect(body.version).toBe(2);
    expect(body.adaptedFrom?.text).toBe("and the softmax?");
    expect(sentToClaude(claude, 1)).toContain(`- Asked: ${QUESTION.question}`);
  });

  it("a regeneration rejected twice keeps the old version too", async () => {
    const logs = quietLogs();
    await saveVersion(1, 0);
    await appendSignal(LESSON, QUESTION);
    script(invalidReply(), invalidReply());
    const res = await post(LESSON, "1");
    expect(res.status).toBe(200);
    expect(StepResponse.parse(await res.json()).version).toBe(1);
    expect(logs.logged()).toContain("failed (rejected), keeping v1");
  });

  it("a regeneration that fails after an older version started: the played version is answered", async () => {
    quietLogs();
    await saveVersion(1, 0);
    await saveVersion(1, 0);
    await appendSignal(LESSON, QUESTION);
    const { release, firstCall } = gatedClaude(fakeMessage("", "refusal"));
    const regenerating = post(LESSON, "1");
    await firstCall;
    await appendSignal(LESSON, { started: 1, version: 1 });
    release();
    expect(StepResponse.parse(await (await regenerating).json()).version).toBe(
      1,
    );
  });

  it("the previous step's narration in the prompt is its played version's, not a newer one", async () => {
    const heard = Step.parse(await readFixture("demo-m1.step.json"));
    await saveStepVersion(
      LESSON,
      0,
      { step: heard, cueTimes: {} },
      new Uint8Array([1]),
    );
    const unheard = { ...heard, narration: "A version nobody heard." };
    await saveStepVersion(
      LESSON,
      0,
      { step: unheard, cueTimes: {} },
      new Uint8Array([2]),
    );
    await appendSignal(LESSON, { started: 0, version: 1 });
    const claude = script(validReply);
    expect((await post(LESSON, "1")).status).toBe(200);
    expect(sentToClaude(claude)).toContain(
      JSON.stringify(stripMarkers(heard.narration).text).slice(1, -1),
    );
    expect(sentToClaude(claude)).not.toContain("A version nobody heard.");
  });

  it("a regeneration whose TTS fails keeps the old version too", async () => {
    const logs = quietLogs();
    await saveVersion(1, 0);
    await appendSignal(LESSON, QUESTION);
    script(validReply);
    state.ttsError = new TtsError("quota", "ElevenLabs TTS returned 429");
    const res = await post(LESSON, "1");
    expect(res.status).toBe(200);
    expect(StepResponse.parse(await res.json()).version).toBe(1);
    expect(logs.logged()).toContain("failed (ttsFailed), keeping v1");
  });

  it("staleGenerating: a question while v1 is generating; a request waiting on it is decided again and gets v2", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { claude, release, firstCall } = gatedClaude(validReply, validReply);
    const first = post(LESSON, "1");
    await firstCall;
    await appendSignal(LESSON, QUESTION);
    const second = post(LESSON, "1");
    release();
    const a = StepResponse.parse(await (await first).json());
    const b = StepResponse.parse(await (await second).json());
    expect(a.version).toBe(1);
    expect(a.signalsVersion).toBe(0);
    expect(b.version).toBe(2);
    expect(b.adaptedFrom?.text).toBe(QUESTION.question);
    expect(claude.calls).toHaveLength(2);
  });

  it("generating x started n: v1 starts playing while v2 is made; v2 is discarded and v1 served", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await saveVersion(1, 0);
    await appendSignal(LESSON, QUESTION);
    const { release, firstCall } = gatedClaude(validReply);
    const regenerating = post(LESSON, "1");
    await firstCall;
    await appendSignal(LESSON, { started: 1, version: 1 });
    release();
    const body = StepResponse.parse(await (await regenerating).json());
    expect(body.version).toBe(1);
    expect(await stepFiles()).toEqual(["step-1.v1.json", "step-1.v1.mp3"]);
    expect(info.mock.calls.flat().join(" ")).toContain(
      `${LESSON} step 1: v1 started while regenerating; discarded`,
    );
  });

  it("a damaged signals.json: logged, read as no signals, and the step is still served", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await saveVersion(1, 0);
    await writeRunFile(LESSON, SIGNALS_FILE, "{ not json");
    const claude = script();
    expect(
      StepResponse.parse(await (await post(LESSON, "1")).json()).version,
    ).toBe(1);
    expect(claude.calls).toHaveLength(0);
    expect(warn.mock.calls.flat().join(" ")).toContain(
      `${LESSON}/${SIGNALS_FILE} is not a signals file`,
    );
  });

  describe("replay mode never regenerates", () => {
    function replay() {
      vi.stubEnv("REPLAY_RUN", LESSON);
      resetEnvForTests();
      return script();
    }

    it("a stale step is served as saved, with no provider call", async () => {
      await saveVersion(1, 0);
      await appendSignal(LESSON, QUESTION);
      const claude = replay();
      const body = StepResponse.parse(await (await post(LESSON, "1")).json());
      expect(body.version).toBe(1);
      expect(claude.calls).toHaveLength(0);
      expect(state.ttsCalls).toBe(0);
      expect(await stepFiles()).toEqual(["step-1.v1.json", "step-1.v1.mp3"]);
    });

    it("the played version is served, not the latest (section 5.5)", async () => {
      await saveVersion(1, 0);
      await saveVersion(1, 1);
      await appendSignal(LESSON, { started: 1, version: 1 });
      const claude = replay();
      const body = StepResponse.parse(await (await post(LESSON, "1")).json());
      expect(body.version).toBe(1);
      expect(claude.calls).toHaveLength(0);
    });
  });
});

describe("E1 (#152): a step's image objects, made by fal alongside TTS", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3]);
  const IMAGE = {
    kind: "image" as const,
    id: "pic_1",
    x: 40,
    y: 640,
    w: 320,
    h: 180,
    prompt: "a lamp on a table, no text",
  };
  const IMAGE_FILE = "img-0-v1-pic-1.jpg";

  /** The recorded step with `images` added to its objectsJson. */
  function withImages(...images: object[]): Anthropic.Message {
    const block = validReply.content.find((c) => c.type === "text");
    if (block?.type !== "text") throw new Error("the fixture has no text");
    const wire = JSON.parse(block.text) as { objectsJson: string };
    wire.objectsJson = JSON.stringify([
      ...(JSON.parse(wire.objectsJson) as object[]),
      ...images,
    ]);
    return fakeMessage(JSON.stringify(wire));
  }

  const imagesOf = (body: StepResponse) =>
    body.step.objects.filter((o) => o.kind === "image");
  const runFiles = async () => readdir(path.join(state.runs, LESSON));
  const imageFiles = async () =>
    (await runFiles()).filter((f) => f.startsWith("img-")).sort();

  function logs() {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const text = (spy: typeof info) =>
      spy.mock.calls
        .flat()
        .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : a))
        .join(" ");
    return { info: () => text(info), warned: () => text(warn) };
  }

  /** Step 0 generated with one image and a fal that gives `reply`; the step must still play. */
  async function stepWithImage(
    ...replies: Parameters<typeof fakeImages>[0] & object
  ) {
    state.images = fakeImages(replies);
    script(withImages(IMAGE));
    const res = await post(LESSON, "0");
    expect(res.status).toBe(200);
    return StepResponse.parse(await res.json());
  }

  it("step has an image, fal ok: the jpg is saved, mediaUrl is set in the response and the saved step", async () => {
    const body = await stepWithImage(JPEG);
    const url = `/api/runs/${LESSON}/${IMAGE_FILE}`;
    expect(imagesOf(body)).toEqual([{ ...IMAGE, mediaUrl: url }]);
    expect(state.images!.prompts).toEqual([IMAGE.prompt]);
    expect(
      new Uint8Array(await readFile(path.join(state.runs, LESSON, IMAGE_FILE))),
    ).toEqual(JPEG);
    const saved = await readRunJson(LESSON, "step-0.v1.json", SavedStep);
    expect(saved?.step.objects.find((o) => o.kind === "image")).toEqual({
      ...IMAGE,
      mediaUrl: url,
    });
    // The narration was made too, in the same request.
    expect(state.ttsCalls).toBe(1);
  });

  it("fal error: the step still plays; the image has no mediaUrl, no file is saved, and it's logged", async () => {
    const log = logs();
    const body = await stepWithImage(new Error("fal is down"));
    expect(imagesOf(body)).toEqual([IMAGE]);
    expect(await imageFiles()).toEqual([]);
    expect(log.warned()).toContain('image "pic_1" not drawn');
    expect(log.warned()).toContain("fal is down");
  });

  it("fal timeout: past config.stepImages.timeoutMs the step still plays, without the image, and it's logged", async () => {
    const log = logs();
    state.imageTimeoutMs = 30;
    // The fake never answers and ignores the abort: only the image's own deadline ends it.
    const body = await stepWithImage("hang");
    expect(imagesOf(body)).toEqual([IMAGE]);
    expect(await imageFiles()).toEqual([]);
    expect(log.warned()).toContain("no image after 30 ms");
  });

  it("no FAL_KEY (no image maker): the step still plays without the image, and it's logged", async () => {
    const log = logs();
    state.images = undefined;
    script(withImages(IMAGE));
    const res = await post(LESSON, "0");
    expect(res.status).toBe(200);
    expect(imagesOf(StepResponse.parse(await res.json()))).toEqual([IMAGE]);
    expect(await imageFiles()).toEqual([]);
    expect(log.info()).toContain("images not drawn (no FAL_KEY)");
  });

  it("non-JPEG bytes: an error; the step still plays without the image, nothing is saved, and it's logged", async () => {
    const log = logs();
    const body = await stepWithImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(imagesOf(body)).toEqual([IMAGE]);
    expect(await imageFiles()).toEqual([]);
    expect(log.warned()).toContain("aren't a JPEG");
  });

  it("lesson already at the cap (its cover and board images, from its files): no fal call, the image isn't drawn, and it's logged", async () => {
    const log = logs();
    await writeRunFile(LESSON, config.cover.file, JPEG);
    for (let i = 1; i < config.maxImagesPerLesson; i++)
      await writeRunFile(LESSON, `img-1-v${i}-pic.jpg`, JPEG);
    const body = await stepWithImage();
    expect(state.images!.prompts).toEqual([]);
    expect(imagesOf(body)).toEqual([IMAGE]);
    expect(log.info()).toContain('image "pic_1" not drawn');
  });

  it("two image objects in a step: only the first is made (config.stepImages.maxPerStep)", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    state.images = fakeImages([JPEG]);
    const second = { ...IMAGE, id: "pic_2", x: 1200, prompt: "a tree" };
    script(withImages(IMAGE, second));
    const body = StepResponse.parse(await (await post(LESSON, "0")).json());
    expect(state.images.prompts).toEqual([IMAGE.prompt]);
    expect(imagesOf(body).map((o) => o.mediaUrl)).toEqual([
      `/api/runs/${LESSON}/${IMAGE_FILE}`,
      undefined,
    ]);
  });

  it("replay (REPLAY_RUN): never calls fal, even for a stale step with an undrawn image", async () => {
    const step = Step.parse({
      ...(await readFixture<object>("demo-m1.step.json")),
    });
    step.objects.push(IMAGE);
    await saveStepVersion(
      LESSON,
      0,
      { step, cueTimes: {} },
      new Uint8Array([1]),
    );
    await appendSignal(LESSON, { question: "why?" });
    state.images = fakeImages([]);
    vi.stubEnv("REPLAY_RUN", LESSON);
    resetEnvForTests();
    const claude = script();
    const body = StepResponse.parse(await (await post(LESSON, "0")).json());
    expect(imagesOf(body)).toEqual([IMAGE]);
    expect(state.images.prompts).toEqual([]);
    expect(claude.calls).toHaveLength(0);
    expect(await imageFiles()).toEqual([]);
  });
});
