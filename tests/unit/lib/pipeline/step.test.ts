// lib/pipeline/step.ts (ROADMAP G1, ARCHITECTURE.md sections 4, 5.1 and 6.2). One test per
// case, named after it. Claude is never called: every test uses lib/fakes/claude.ts.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "@/lib/config";
import { resetEnvForTests } from "@/lib/env";
import { readFixture } from "@/lib/fakes";
import { fakeClaude, fakeMessage } from "@/lib/fakes/claude";
import { STEP_OUTPUT_FORMAT } from "@/lib/pipeline/outputFormat";
import { STEP_SYSTEM_PROMPT } from "@/lib/pipeline/prompts/step";
import { GenerationError } from "@/lib/pipeline/generate";
import {
  buildStepRequest,
  generateStep,
  type StepRequest,
} from "@/lib/pipeline/step";
import type { LessonPlanOutput } from "@/shared/lesson";
import { Step } from "@/shared/scene";

const PLAN: LessonPlanOutput = {
  title: "A lesson",
  coverPrompt: "a cover",
  steps: [
    { title: "First idea", goal: "Introduce the first idea." },
    { title: "Second idea", goal: "Build the second idea on the first." },
  ],
};
const REQ: StepRequest = {
  paperFileId: "file_test123",
  plan: PLAN,
  n: 1,
  previousNarration: "We met the [[a]]first idea.",
  signals: [],
};

let valid: Step;
/** Valid JSON that fails validate.ts: an action cued on a marker the narration doesn't have. */
let invalid: Step;
beforeAll(async () => {
  valid = Step.parse(await readFixture("demo-m1.step.json"));
  invalid = {
    ...valid,
    actions: [{ ...valid.actions[0], cue: "nowhere" }, ...valid.actions],
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnvForTests();
});

/** Runs generateStep against the scripted replies; returns the error it threw. */
async function failure(replies: Parameters<typeof fakeClaude>[0]) {
  const claude = fakeClaude(replies);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const err = await generateStep(REQ, claude).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(GenerationError);
  return { err: err as GenerationError, claude };
}

describe("generateStep (G1)", () => {
  it("valid first time: returns the step after one request", async () => {
    const claude = fakeClaude([fakeMessage(JSON.stringify(valid))]);
    await expect(generateStep(REQ, claude)).resolves.toEqual(valid);
    expect(claude.calls).toHaveLength(1);
  });

  it("invalid then valid: retries once with the errors, then returns the step", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rejected = fakeMessage(JSON.stringify(invalid));
    const claude = fakeClaude([rejected, fakeMessage(JSON.stringify(valid))]);

    await expect(generateStep(REQ, claude)).resolves.toEqual(valid);

    expect(claude.calls).toHaveLength(2);
    const [first, retry] = claude.calls.map((c) => c.body);
    // Same cached prefix, then what Claude wrote, then why it was rejected.
    expect(retry.system).toEqual(first.system);
    expect(retry.messages.slice(0, 1)).toEqual(first.messages);
    expect(retry.messages[1]).toEqual({
      role: "assistant",
      content: rejected.content,
    });
    expect(retry.messages[2].role).toBe("user");
    expect(retry.messages[2].content).toContain('unknown cue "nowhere"');
    expect(warn).toHaveBeenCalledOnce();
  });

  it("output that fails the zod schema is a rejection, retried with the schema error", async () => {
    const noTitle = { ...valid, title: "" };
    const { claude } = await failure([
      fakeMessage(JSON.stringify(noTitle)),
      new Anthropic.InternalServerError(
        500,
        undefined,
        "stop here",
        new Headers(),
      ),
    ]);
    expect(claude.calls[1].body.messages[2].content).toMatch(/^.*\n- title:/);
  });

  it("output that isn't JSON is a rejection, retried", async () => {
    const claude = fakeClaude([
      fakeMessage("not json"),
      fakeMessage(JSON.stringify(valid)),
    ]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(generateStep(REQ, claude)).resolves.toEqual(valid);
    expect(claude.calls[1].body.messages[2].content).toContain(
      "the output is not valid JSON",
    );
  });

  it("invalid twice: fails as rejected, with the second attempt's errors", async () => {
    const { err, claude } = await failure([
      fakeMessage(JSON.stringify(invalid)),
      fakeMessage(JSON.stringify({ ...valid, title: "" })),
    ]);
    expect(claude.calls).toHaveLength(2);
    expect(err.reason).toBe("rejected");
    expect(err.errors.length).toBeGreaterThan(0);
    expect(err.errors.every((e) => e.startsWith("title:"))).toBe(true);
  });

  it("refusal: fails as refusal, with no retry", async () => {
    const { err, claude } = await failure([
      fakeMessage("", "refusal", {
        type: "refusal",
        category: "general_harms",
        explanation: null,
      }),
    ]);
    expect(err.reason).toBe("refusal");
    expect(err.message).toContain("general_harms");
    expect(claude.calls).toHaveLength(1);
  });

  it("refusal on the retry: fails as refusal", async () => {
    const { err } = await failure([
      fakeMessage(JSON.stringify(invalid)),
      fakeMessage("", "refusal"),
    ]);
    expect(err.reason).toBe("refusal");
  });

  it("max_tokens cut-off: fails as cut-off, with no retry", async () => {
    const { err, claude } = await failure([
      fakeMessage('{"title": "cut', "max_tokens"),
    ]);
    expect(err.reason).toBe("cut-off");
    expect(claude.calls).toHaveLength(1);
  });

  it("context window cut-off: fails as cut-off, with no retry", async () => {
    const { err, claude } = await failure([
      fakeMessage('{"title": "cut', "model_context_window_exceeded"),
    ]);
    expect(err.reason).toBe("cut-off");
    expect(claude.calls).toHaveLength(1);
  });

  it("narration over config.maxNarrationChars is a rejection, retried with narration too long", async () => {
    const long = {
      ...valid,
      narration: `${valid.narration} ${"word ".repeat(config.maxNarrationChars / 5)}`,
    };
    const claude = fakeClaude([
      fakeMessage(JSON.stringify(long)),
      fakeMessage(JSON.stringify(valid)),
    ]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(generateStep(REQ, claude)).resolves.toEqual(valid);
    expect(claude.calls[1].body.messages[2].content).toContain(
      "narration too long",
    );
  });

  it("an empty first answer is retried without an empty assistant turn", async () => {
    const empty = { ...fakeMessage(""), content: [] };
    const claude = fakeClaude([empty, fakeMessage(JSON.stringify(valid))]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(generateStep(REQ, claude)).resolves.toEqual(valid);
    const retry = claude.calls[1].body.messages;
    expect(retry.map((m) => m.role)).toEqual(["user", "user"]);
  });

  it("API error (after the SDK's retries): fails as provider, keeping the cause", async () => {
    const apiError = new Anthropic.InternalServerError(
      529,
      { type: "error", error: { type: "overloaded_error" } },
      "Overloaded",
      new Headers(),
    );
    const { err, claude } = await failure([apiError]);
    expect(err.reason).toBe("provider");
    expect(err.message).toContain("overloaded_error");
    expect(err.cause).toBe(apiError);
    expect(claude.calls).toHaveLength(1);
  });

  it("timeout: config.step.timeoutMs passing (the request aborts) fails as provider, with no retry", async () => {
    const { err, claude } = await failure([new Anthropic.APIUserAbortError()]);
    expect(err.reason).toBe("provider");
    expect(err.message).toContain(
      `timed out after ${config.step.timeoutMs} ms`,
    );
    expect(claude.calls).toHaveLength(1);
  });

  it("each attempt gets an abort signal as its total deadline", async () => {
    const claude = fakeClaude([fakeMessage(JSON.stringify(valid))]);
    await generateStep(REQ, claude);
    expect(claude.calls[0].options?.signal).toBeInstanceOf(AbortSignal);
    expect(claude.calls[0].options?.signal?.aborted).toBe(false);
  });

  it("a connection timeout (after the SDK's retries) fails as provider", async () => {
    const { err, claude } = await failure([
      new Anthropic.APIConnectionTimeoutError(),
    ]);
    expect(err.reason).toBe("provider");
    expect(err.message).toContain("APIConnectionTimeoutError");
    expect(claude.calls).toHaveLength(1);
  });

  it("an error that isn't the SDK's propagates as is (a bug in a fake or our code, not a failed step)", async () => {
    const bug = new TypeError("boom");
    const claude = fakeClaude([bug]);
    await expect(generateStep(REQ, claude)).rejects.toBe(bug);
  });

  it("FAKE_APIS=1 with no client: serves the recorded step response, which is valid", async () => {
    vi.stubEnv("FAKE_APIS", "1");
    vi.stubEnv("REPLAY_RUN", undefined);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    resetEnvForTests();
    const step = await generateStep(REQ);
    const fixture = await readFixture<Anthropic.Message>(config.step.fixture);
    const text = fixture.content.find((b) => b.type === "text");
    expect(step).toEqual(Step.parse(JSON.parse(text!.text)));
  });
});

describe("buildStepRequest", () => {
  it("uses the model, effort and output cap from lib/config.ts", () => {
    const body = buildStepRequest(REQ);
    expect(body.model).toBe(config.models.step);
    expect(body.output_config?.effort).toBe(config.effort.step);
    expect(body.max_tokens).toBe(config.step.maxTokens);
  });

  it("asks for structured output with the step output format", () => {
    expect(buildStepRequest(REQ).output_config?.format).toBe(
      STEP_OUTPUT_FORMAT,
    );
  });

  it("the step output format is the SDK's JSON schema for Step", () => {
    expect(STEP_OUTPUT_FORMAT).toEqual({
      type: "json_schema",
      schema: zodOutputFormat(Step).schema,
    });
  });

  it("sends the paper by file id first, cached for 1 hour, then the step's context", () => {
    const [message] = buildStepRequest(REQ).messages;
    const content = message.content as Anthropic.ContentBlockParam[];
    expect(content[0]).toEqual({
      type: "document",
      source: { type: "file", file_id: "file_test123" },
      cache_control: { type: "ephemeral", ttl: "1h" },
    });
    expect(content[1]).toMatchObject({ type: "text" });
    expect((content[1] as Anthropic.TextBlockParam).text).toContain(
      "Second idea",
    );
  });

  it("the system prompt is the same for every step, so the cached paper is reused", () => {
    const a = buildStepRequest({ ...REQ, n: 0 });
    const b = buildStepRequest({
      ...REQ,
      n: 1,
      signals: [{ question: "why?" }],
    });
    expect(a.system).toBe(STEP_SYSTEM_PROMPT);
    expect(b.system).toBe(STEP_SYSTEM_PROMPT);
  });
});
