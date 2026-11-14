// One structured-output Claude request, validated and retried once (ARCHITECTURE.md sections
// 4 and 6.2). Shared by the step and sketch generators: a rejection (output that isn't JSON, a
// zod schema error or a validate.ts rejection) is retried once with the errors, and a second
// rejection, a refusal, a cut-off or a provider error fails with a typed GenerationError.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ValidationResult } from "@/shared/validate";
import { getEnv } from "@/lib/env";
import { fakeClaude } from "@/lib/fakes/claude";

/**
 * The part of the SDK client the generators use, so tests and FAKE_APIS=1 can pass a fake.
 * `client.messages` of a real `Anthropic` client satisfies it.
 */
export interface ClaudeMessages {
  stream(
    body: Anthropic.MessageStreamParams,
    options?: Anthropic.RequestOptions,
  ): { finalMessage(): Promise<Anthropic.Message> };
}

/**
 * Why a generation failed (the `failed` causes in section 6.2). `rejected`: invalid twice, with
 * the second attempt's errors. `refusal`: Claude declined. `cut-off`: the output hit the
 * request's `max_tokens`. `provider`: an API or network error, or a timeout, after the SDK's
 * own retries. The message is for the server log; the learner sees plain words (section 7).
 */
export class GenerationError extends Error {
  override name = "GenerationError";
  constructor(
    readonly reason: "rejected" | "refusal" | "cut-off" | "provider",
    message: string,
    readonly errors: readonly string[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface Generation<T> {
  /** What is generated, for logs and error messages, e.g. "step 3" or "sketch". */
  label: string;
  /** The first attempt's request. */
  request: Anthropic.MessageStreamParams;
  /** Parses and checks Claude's JSON. */
  validate(json: unknown): ValidationResult<T>;
  /** The user turn sent after a rejection, listing its errors. */
  retryPrompt(errors: readonly string[]): string;
  /** Deadline for one attempt, the SDK's own retries included, until the whole answer is in. */
  timeoutMs: number;
}

/** Runs the request, retrying a rejection once. Throws GenerationError. */
export async function generateWithRetry<T>(
  gen: Generation<T>,
  messages: ClaudeMessages,
): Promise<T> {
  const firstTry = await attempt(gen, messages, gen.request);
  if (firstTry.result.ok) return firstTry.result.value;

  console.warn(
    `[pipeline] ${gen.label} rejected, retrying once: ${firstTry.result.errors.join("; ")}`,
  );
  // The model sees what it wrote and why it was rejected. Its content (thinking included)
  // goes back unchanged, after the same cached prefix. The API rejects an empty assistant turn.
  const answer: Anthropic.MessageParam[] =
    firstTry.content.length > 0
      ? [{ role: "assistant", content: firstTry.content }]
      : [];
  const retry: Anthropic.MessageStreamParams = {
    ...gen.request,
    messages: [
      ...gen.request.messages,
      ...answer,
      { role: "user", content: gen.retryPrompt(firstTry.result.errors) },
    ],
  };
  const secondTry = await attempt(gen, messages, retry);
  if (secondTry.result.ok) return secondTry.result.value;
  throw new GenerationError(
    "rejected",
    `${gen.label}: rejected twice: ${secondTry.result.errors.join("; ")}`,
    secondTry.result.errors,
  );
}

interface Attempt<T> {
  result: ValidationResult<T>;
  content: Anthropic.ContentBlock[];
}

async function attempt<T>(
  gen: Generation<T>,
  messages: ClaudeMessages,
  body: Anthropic.MessageStreamParams,
): Promise<Attempt<T>> {
  let message: Anthropic.Message;
  try {
    // A total deadline: the SDK's `timeout` stops once headers arrive, and a stream then
    // waits as long as the socket stays open.
    message = await messages
      .stream(body, { signal: AbortSignal.timeout(gen.timeoutMs) })
      .finalMessage();
  } catch (err) {
    // The real stream reports every failure as an AnthropicError: HTTP and connection errors
    // (APIError), our deadline (APIUserAbortError), and anything else it wraps.
    if (!(err instanceof Anthropic.AnthropicError)) throw err;
    const what =
      err instanceof Anthropic.APIUserAbortError
        ? `timed out after ${gen.timeoutMs} ms`
        : `failed: ${err.name}: ${err.message}`;
    throw new GenerationError(
      "provider",
      `${gen.label}: Claude request ${what}`,
      [],
      { cause: err },
    );
  }

  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category ?? "none";
    throw new GenerationError(
      "refusal",
      `${gen.label}: Claude declined (category: ${category})`,
    );
  }
  if (
    message.stop_reason === "max_tokens" ||
    message.stop_reason === "model_context_window_exceeded"
  ) {
    throw new GenerationError(
      "cut-off",
      `${gen.label}: cut off (${message.stop_reason}, max_tokens ${body.max_tokens})`,
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
  return { result: gen.validate(json), content: message.content };
}

/**
 * Real Claude, or the recorded response `fixture` (in lib/fakes/fixtures/) when FAKE_APIS=1.
 * Replay mode serves saved runs and never calls it.
 */
export function claudeMessages(fixture: string): ClaudeMessages {
  const env = getEnv();
  switch (env.mode) {
    case "real":
      // A key passed in code is the client's only credential: the SDK then reads no other
      // env var or login profile.
      return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }).messages;
    case "fake":
      return fakeClaude(undefined, fixture);
    case "replay":
      throw new Error("replay mode serves saved runs and never calls Claude");
  }
}
