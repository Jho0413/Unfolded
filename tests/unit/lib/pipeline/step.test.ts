// lib/pipeline/step.ts (ROADMAP G1, ARCHITECTURE.md sections 4, 5.1 and 6.2). One test per
// case, named after it. Claude is never called: every test uses lib/fakes/claude.ts.
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "@/lib/config";
import { resetEnvForTests } from "@/lib/env";
import { readFixture } from "@/lib/fakes";
import { fakeClaude, fakeMessage } from "@/lib/fakes/claude";
import { STEP_OUTPUT_FORMAT, wireToStep } from "@/lib/pipeline/outputFormat";
import { STEP_SYSTEM_PROMPT } from "@/lib/pipeline/prompts/step";
import { GenerationError } from "@/lib/pipeline/generate";
import { quoteErrors } from "@/lib/pipeline/paperQuotes";
import { paperContextPrompt } from "@/lib/pipeline/prompts/paper";
import {
  buildStepRequest,
  generateStep,
  type StepRequest,
} from "@/lib/pipeline/step";
import type { LessonPlanOutput } from "@/shared/lesson";
import { type CuedPaperRef, MAX_PAPER_QUOTE_CHARS, Step } from "@/shared/scene";

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
  // Titled as REQ's plan step: generateStep gives every step its plan title.
  valid = {
    ...Step.parse(await readFixture("demo-m1.step.json")),
    title: PLAN.steps[1].title,
  };
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

/** A step as Claude writes it on the wire: demo-m1 has no heatmaps or plots, so objectsJson is []. */
const asWire = (step: object) => JSON.stringify({ ...step, objectsJson: "[]" });

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
    const claude = fakeClaude([fakeMessage(asWire(valid))]);
    await expect(generateStep(REQ, claude)).resolves.toEqual(valid);
    expect(claude.calls).toHaveLength(1);
  });

  it("a step Claude titles differently keeps the plan's title (QA pass 2)", async () => {
    const claude = fakeClaude([
      fakeMessage(asWire({ ...valid, title: "Multiplying two matrices" })),
    ]);
    await expect(generateStep(REQ, claude)).resolves.toEqual(valid);
    expect(valid.title).toBe("Second idea");
  });

  it("invalid then valid: retries once with the errors, then returns the step", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rejected = fakeMessage(asWire(invalid));
    const claude = fakeClaude([rejected, fakeMessage(asWire(valid))]);

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
      fakeMessage(asWire(noTitle)),
      new Anthropic.InternalServerError(
        500,
        undefined,
        "stop here",
        new Headers(),
      ),
    ]);
    expect(claude.calls[1].body.messages[2].content).toMatch(/^.*\n- title:/);
  });

  it("a wire action that can't convert (a move without to) is a rejection, retried with its error", async () => {
    const move = valid.actions.find((a) => a.do === "move")!;
    const noTo = { ...move, to: undefined };
    const claude = fakeClaude([
      fakeMessage(asWire({ ...valid, actions: [noTo] })),
      fakeMessage(asWire(valid)),
    ]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(generateStep(REQ, claude)).resolves.toEqual(valid);
    expect(claude.calls[1].body.messages[2].content).toContain(
      `move needs to "${noTo.target.id}"`,
    );
  });

  it("output that isn't JSON is a rejection, retried", async () => {
    const claude = fakeClaude([
      fakeMessage("not json"),
      fakeMessage(asWire(valid)),
    ]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(generateStep(REQ, claude)).resolves.toEqual(valid);
    expect(claude.calls[1].body.messages[2].content).toContain(
      "the output is not valid JSON",
    );
  });

  it("invalid twice: fails as rejected, with the second attempt's errors", async () => {
    const { err, claude } = await failure([
      fakeMessage(asWire(invalid)),
      fakeMessage(asWire({ ...valid, title: "" })),
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
      fakeMessage(asWire(invalid)),
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
      fakeMessage(asWire(long)),
      fakeMessage(asWire(valid)),
    ]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(generateStep(REQ, claude)).resolves.toEqual(valid);
    expect(claude.calls[1].body.messages[2].content).toContain(
      "narration too long",
    );
  });

  it("an empty first answer is retried without an empty assistant turn", async () => {
    const empty = { ...fakeMessage(""), content: [] };
    const claude = fakeClaude([empty, fakeMessage(asWire(valid))]);
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
    const claude = fakeClaude([fakeMessage(asWire(valid))]);
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

  it("FAKE_APIS=1 with no client: serves the recorded step response, which is valid, with its paper quotes", async () => {
    vi.stubEnv("FAKE_APIS", "1");
    vi.stubEnv("REPLAY_RUN", undefined);
    resetEnvForTests();
    const fixture = await readFixture<Anthropic.Message>(config.step.fixture);
    const text = fixture.content.find((b) => b.type === "text");
    const expected = {
      ...wireToStep(JSON.parse(text!.text)).value,
      title: PLAN.steps[1].title,
    };
    // The fixture quotes the Attention paper's page 4 (m2-attention): a paper with that text.
    const refs = expected.paperRefs ?? [];
    expect(refs.length).toBeGreaterThan(0);
    const pages = ["", "", "", refs.map((r) => r.quote).join(" ")];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const step = await generateStep({ ...REQ, paperPages: pages });
    expect(step).toEqual(expected);
    // Nothing rejected or dropped (the env's own fake-mode notice aside).
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("[pipeline]"),
    );
  });
});

describe("paper quotes (#98): one test per row", () => {
  const PAGES = [
    "Matrix Multiplication by Hand. We show how to multiply two matrices.",
    "1 MethodPair their entries and multiply each pair. The products of the pairedentries are add-ed together.",
  ];
  const FOUND: CuedPaperRef = {
    page: 2,
    quote: "The products of the paired entries are added together",
    label: "Section 1",
    cue: "add",
  };
  const ALSO_FOUND: CuedPaperRef = { page: 1, quote: "multiply two matrices" };
  const MISSING: CuedPaperRef = { page: 2, quote: "A sentence never written" };
  const WRONG_PAGE: CuedPaperRef = { page: 1, quote: "Pair their entries" };
  const REQ_PAPER: StepRequest = { ...REQ, paperPages: PAGES };
  const withRefs = (...paperRefs: CuedPaperRef[]): Step => ({
    ...valid,
    paperRefs,
  });
  const reply = (step: Step) => fakeMessage(asWire(step));
  const context = (claude: ReturnType<typeof fakeClaude>) =>
    JSON.stringify(claude.calls[0].body.messages[0].content);
  const warnings = (warn: { mock: { calls: unknown[][] } }) =>
    warn.mock.calls.flat().join(" ");

  it("all quotes found: the step comes back with its paperRefs, after one request that asked for them", async () => {
    const claude = fakeClaude([reply(withRefs(ALSO_FOUND, FOUND))]);
    await expect(generateStep(REQ_PAPER, claude)).resolves.toEqual(
      withRefs(ALSO_FOUND, FOUND),
    );
    expect(claude.calls).toHaveLength(1);
    expect(context(claude)).toContain(paperContextPrompt(PAGES.length));
  });

  it("some missing, the retry fixes them: the step with paperRefs; the retry named the missing quote and its page", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const claude = fakeClaude([
      reply(withRefs(FOUND, MISSING)),
      reply(withRefs(FOUND, ALSO_FOUND)),
    ]);
    await expect(generateStep(REQ_PAPER, claude)).resolves.toEqual(
      withRefs(FOUND, ALSO_FOUND),
    );
    expect(claude.calls).toHaveLength(2);
    expect(claude.calls[1].body.messages[2].content).toContain(
      quoteErrors.notOnPage(1, 2, MISSING.quote),
    );
  });

  it("still missing after the retry: those refs dropped and logged; the step is kept", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const claude = fakeClaude([
      reply(withRefs(FOUND, MISSING)),
      reply(withRefs(FOUND, MISSING)),
    ]);
    await expect(generateStep(REQ_PAPER, claude)).resolves.toEqual(
      withRefs(FOUND),
    );
    expect(claude.calls).toHaveLength(2);
    expect(warnings(warn)).toContain(
      quoteErrors.notOnPage(1, 2, MISSING.quote),
    );
  });

  it("still missing and the retry fails (a provider error): the first attempt is kept without them", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const claude = fakeClaude([
      reply(withRefs(MISSING)),
      new Anthropic.InternalServerError(500, undefined, "down", new Headers()),
    ]);
    const step = await generateStep(REQ_PAPER, claude);
    expect(step).toEqual(valid);
    expect(step).not.toHaveProperty("paperRefs");
  });

  it("a quote missing in the first attempt and a hard error in the retry: the first, without the missing quote", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const claude = fakeClaude([
      reply(withRefs(FOUND, MISSING)),
      reply({ ...withRefs(FOUND), title: "" }),
    ]);
    await expect(generateStep(REQ_PAPER, claude)).resolves.toEqual(
      withRefs(FOUND),
    );
  });

  it("a hard error in the first attempt and a quote missing in the retry: the retry, without the missing quote", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const claude = fakeClaude([
      reply({ ...withRefs(FOUND), title: "" }),
      reply(withRefs(MISSING, ALSO_FOUND)),
    ]);
    await expect(generateStep(REQ_PAPER, claude)).resolves.toEqual(
      withRefs(ALSO_FOUND),
    );
  });

  it("a malformed ref (an over-long quote, page 0): dropped and logged, not a rejection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const claude = fakeClaude([
      reply({
        ...withRefs(FOUND),
        paperRefs: [
          { page: 0, quote: "x" },
          FOUND,
          { page: 2, quote: "y".repeat(MAX_PAPER_QUOTE_CHARS + 1) },
        ],
      }),
    ]);
    await expect(generateStep(REQ_PAPER, claude)).resolves.toEqual(
      withRefs(FOUND),
    );
    expect(claude.calls).toHaveLength(1);
    expect(warnings(warn)).toContain("paperRefs.0 dropped");
    expect(warnings(warn)).toContain("paperRefs.2 dropped");
  });

  it("quote on the wrong page: treated as missing (retried with where it is, then dropped)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const claude = fakeClaude([
      reply(withRefs(WRONG_PAGE)),
      reply(withRefs(WRONG_PAGE)),
    ]);
    await expect(generateStep(REQ_PAPER, claude)).resolves.toEqual(valid);
    expect(claude.calls[1].body.messages[2].content).toContain(
      quoteErrors.notOnPage(0, 1, WRONG_PAGE.quote, 2),
    );
  });

  it("no paper.pdf (or its text couldn't be extracted): no quotes asked for, none verified, any written dropped without a retry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const claude = fakeClaude([reply(withRefs(MISSING))]);
    await expect(generateStep(REQ, claude)).resolves.toEqual(valid);
    expect(claude.calls).toHaveLength(1);
    expect(context(claude)).toContain(paperContextPrompt(undefined));
    expect(warnings(warn)).toContain(quoteErrors.noPaper(1));
  });

  it("a paperRefs cue not in the narration: the validator rejects it, so the retry runs", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const claude = fakeClaude([
      reply(withRefs({ ...FOUND, cue: "nowhere" })),
      reply(withRefs(FOUND)),
    ]);
    await expect(generateStep(REQ_PAPER, claude)).resolves.toEqual(
      withRefs(FOUND),
    );
    expect(claude.calls[1].body.messages[2].content).toContain(
      'unknown cue "nowhere"',
    );
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
