// One structured-output Claude request, validated and retried once (ARCHITECTURE.md sections
// 4 and 6.2). Shared by the step, sketch and plan generators: a rejection (output that isn't JSON, a
// zod schema error or a validate.ts rejection) is retried once with the errors, and a second
// rejection, a refusal, a cut-off or a provider error fails with a typed GenerationError. An
// attempt with only soft problems (a sketch's overlaps) is used when neither is valid
// (chooseAttempt), and a valid one's warnings (a sketch's tight spacing) are only logged.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ValidationResult } from "@/shared/validate";
import { getEnv } from "@/lib/env";
import { fakeClaude, fakeFiles } from "@/lib/fakes/claude";

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
  if (firstTry.result.ok) {
    logSoft(gen.label, firstTry.result.warnings ?? []);
    return firstTry.result.value;
  }

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
  let secondTry: Attempt<T>;
  try {
    secondTry = await attempt(gen, messages, retry);
  } catch (err) {
    // The retry was only for a better layout: if it times out or fails, a first attempt with
    // only soft problems (a sketch's overlaps) is still drawn, not lost (#90, a real case).
    const usable = firstTry.result.softOnly;
    if (usable === undefined) throw err;
    console.warn(
      `[pipeline] ${gen.label} retry failed, using the first attempt: ${err instanceof Error ? err.message : String(err)}`,
    );
    logSoft(gen.label, firstTry.result.errors);
    return usable.value;
  }
  const chosen = chooseAttempt(firstTry.result, secondTry.result);
  if ("value" in chosen) {
    logSoft(gen.label, chosen.softErrors);
    return chosen.value;
  }
  // The rejected output, so the next failure can be diagnosed (server log only).
  console.error(
    `[pipeline] ${gen.label} rejected output (second attempt): ${truncate(secondTry.text, MAX_LOGGED_OUTPUT_CHARS)}`,
  );
  throw new GenerationError(
    "rejected",
    `${gen.label}: rejected twice: ${chosen.errors.join("; ")}`,
    chosen.errors,
  );
}

function logSoft(label: string, softErrors: readonly string[]): void {
  if (softErrors.length > 0)
    console.warn(
      `[pipeline] ${label} used with soft problems only: ${softErrors.join("; ")}`,
    );
}

/** How much of a rejected output goes to the server log. */
export const MAX_LOGGED_OUTPUT_CHARS = 4000;

function truncate(text: string, max: number): string {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}… (${text.length - max} more characters)`;
}

/**
 * Which of two attempts to use (pure; ARCHITECTURE.md section 4). A valid attempt wins, the
 * first if both are, with its warnings (a sketch's tight spacing) to log. Failing that, one
 * with only soft problems (a sketch's overlaps) can still be used: the one with fewer, the
 * second on a tie. With a hard problem in both, it fails with the second attempt's errors.
 */
export function chooseAttempt<T>(
  first: ValidationResult<T>,
  second: ValidationResult<T>,
): { value: T; softErrors: string[] } | { errors: string[] } {
  if (first.ok) return { value: first.value, softErrors: first.warnings ?? [] };
  if (second.ok)
    return { value: second.value, softErrors: second.warnings ?? [] };
  const [a, b] = [first.softOnly, second.softOnly];
  if (b && (!a || b.count <= a.count))
    return { value: b.value, softErrors: second.errors };
  if (a) return { value: a.value, softErrors: first.errors };
  return { errors: second.errors };
}

/**
 * A failed SDK call as a `provider` GenerationError, keeping the SDK's error as its cause. The
 * SDK reports every failure as an AnthropicError: HTTP and connection errors (APIError), our
 * deadline (APIUserAbortError), and anything else it wraps. Any other error is a bug in a fake
 * or our code, so it's returned as it is, to be rethrown.
 */
export function providerError(
  err: unknown,
  what: string,
  timeoutMs: number,
): unknown {
  if (!(err instanceof Anthropic.AnthropicError)) return err;
  const how =
    err instanceof Anthropic.APIUserAbortError
      ? `timed out after ${timeoutMs} ms`
      : `failed: ${err.name}: ${err.message}`;
  return new GenerationError("provider", `${what} ${how}`, [], { cause: err });
}

interface Attempt<T> {
  result: ValidationResult<T>;
  content: Anthropic.ContentBlock[];
  /** The output's text, for the log when it's rejected. */
  text: string;
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
    throw providerError(err, `${gen.label}: Claude request`, gen.timeoutMs);
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
      text,
    };
  }
  return { result: gen.validate(json), content: message.content, text };
}

/** The part of the SDK client that uploads the paper (Files API), so tests can pass a fake. */
export interface ClaudeFiles {
  upload(
    params: Anthropic.FileUploadParams,
    options?: Anthropic.RequestOptions,
  ): Promise<Anthropic.FileMetadata>;
}

/** The real client in real mode; undefined in fake mode. Replay mode never calls Claude. */
function realClient(): Anthropic | undefined {
  const env = getEnv();
  switch (env.mode) {
    case "real":
      // A key passed in code is the client's only credential: the SDK then reads no other
      // env var or login profile.
      return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    case "fake":
      return undefined;
    case "replay":
      throw new Error("replay mode serves saved runs and never calls Claude");
  }
}

/** Real Claude, or the recorded response `fixture` (in lib/fakes/fixtures/) when FAKE_APIS=1. */
export function claudeMessages(fixture: string): ClaudeMessages {
  return realClient()?.messages ?? fakeClaude(undefined, fixture);
}

/** The real Files API, or the recorded upload `fixture` when FAKE_APIS=1. */
export function claudeFiles(fixture: string): ClaudeFiles {
  return realClient()?.files ?? fakeFiles(undefined, fixture);
}
