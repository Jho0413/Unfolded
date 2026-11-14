// Step generation (ARCHITECTURE.md sections 4, 5.1 and 6.2): Claude writes a Step with
// structured output, validate.ts checks it, a rejection is retried once with the errors, and
// a second rejection, a refusal, a cut-off or a provider error fails the step.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { LessonPlanOutput, Signal } from "@/shared/lesson";
import type { Step } from "@/shared/scene";
import { validateStep, type ValidationResult } from "@/shared/validate";
import { config } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { fakeClaude } from "@/lib/fakes/claude";
import { STEP_OUTPUT_FORMAT } from "@/lib/pipeline/outputFormat";
import {
  retryPrompt,
  STEP_SYSTEM_PROMPT,
  stepContextPrompt,
} from "@/lib/pipeline/prompts/step";

export interface StepRequest {
  /** The paper's Files API id, uploaded once by the plan route (section 5.1). */
  paperFileId: string;
  plan: LessonPlanOutput;
  /** Which plan step to write (0-based). The route has checked it's in the plan. */
  n: number;
  /** The previous step's narration, if it has been generated. */
  previousNarration?: string;
  /** The learner's signals so far (section 5.4). */
  signals: readonly Signal[];
}

/**
 * The part of the SDK client this file uses, so tests and FAKE_APIS=1 can pass a fake.
 * `client.messages` of a real `Anthropic` client satisfies it.
 */
export interface ClaudeMessages {
  stream(
    body: Anthropic.MessageStreamParams,
    options?: Anthropic.RequestOptions,
  ): { finalMessage(): Promise<Anthropic.Message> };
}

/**
 * Why a step failed (the `failed` causes in section 6.2). `rejected`: invalid twice, with the
 * second attempt's errors. `refusal`: Claude declined. `cut-off`: the output hit
 * `config.stepMaxTokens`. `provider`: an API or network error, or a timeout, after the SDK's
 * own retries. The message is for the server log; the learner sees "Couldn't make this step."
 */
export class StepGenerationError extends Error {
  override name = "StepGenerationError";
  constructor(
    readonly reason: "rejected" | "refusal" | "cut-off" | "provider",
    message: string,
    readonly errors: readonly string[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** The first attempt's request (pure). The document block is cached for an hour (section 5.1). */
export function buildStepRequest(
  req: StepRequest,
): Anthropic.MessageStreamParams {
  return {
    model: config.models.step,
    max_tokens: config.stepMaxTokens,
    system: STEP_SYSTEM_PROMPT,
    output_config: { effort: config.effort.step, format: STEP_OUTPUT_FORMAT },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "file", file_id: req.paperFileId },
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
          { type: "text", text: stepContextPrompt(req) },
        ],
      },
    ],
  };
}

/** Writes and validates step `req.n`. Throws StepGenerationError. */
export async function generateStep(
  req: StepRequest,
  messages: ClaudeMessages = defaultMessages(),
): Promise<Step> {
  const first = buildStepRequest(req);
  const firstTry = await attempt(messages, first);
  if (firstTry.result.ok) return firstTry.result.value;

  console.warn(
    `[step] step ${req.n} rejected, retrying once: ${firstTry.result.errors.join("; ")}`,
  );
  // The model sees what it wrote and why it was rejected. Its content (thinking included)
  // goes back unchanged, after the same cached prefix.
  const retry: Anthropic.MessageStreamParams = {
    ...first,
    messages: [
      ...first.messages,
      { role: "assistant", content: firstTry.content },
      { role: "user", content: retryPrompt(firstTry.result.errors) },
    ],
  };
  const secondTry = await attempt(messages, retry);
  if (secondTry.result.ok) return secondTry.result.value;
  throw new StepGenerationError(
    "rejected",
    `step ${req.n} rejected twice: ${secondTry.result.errors.join("; ")}`,
    secondTry.result.errors,
  );
}

interface Attempt {
  result: ValidationResult<Step>;
  content: Anthropic.ContentBlock[];
}

async function attempt(
  messages: ClaudeMessages,
  body: Anthropic.MessageStreamParams,
): Promise<Attempt> {
  let message: Anthropic.Message;
  try {
    message = await messages
      .stream(body, { timeout: config.stepTimeoutMs })
      .finalMessage();
  } catch (err) {
    // APIError covers HTTP errors, connection errors and timeouts; the base class also covers
    // a stream that ends without a message. Anything else is our bug and propagates as is.
    if (!(err instanceof Anthropic.AnthropicError)) throw err;
    throw new StepGenerationError(
      "provider",
      `Claude step request failed: ${err.name}: ${err.message}`,
      [],
      { cause: err },
    );
  }

  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category ?? "none";
    throw new StepGenerationError(
      "refusal",
      `Claude declined the step (category: ${category})`,
    );
  }
  if (message.stop_reason === "max_tokens") {
    throw new StepGenerationError(
      "cut-off",
      `Claude's step hit max_tokens (${config.stepMaxTokens})`,
    );
  }

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      result: { ok: false, errors: ["the output is not valid JSON"] },
      content: message.content,
    };
  }
  return {
    result: validateStep(json, { maxNarrationChars: config.maxNarrationChars }),
    content: message.content,
  };
}

/** Real Claude, or the recorded step response when FAKE_APIS=1. Replay mode never calls it. */
function defaultMessages(): ClaudeMessages {
  const env = getEnv();
  switch (env.mode) {
    case "real":
      // A key passed in code is the client's only credential: the SDK then reads no other
      // env var or login profile.
      return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }).messages;
    case "fake":
      return fakeClaude();
    case "replay":
      throw new Error("replay mode serves saved steps and never calls Claude");
  }
}
