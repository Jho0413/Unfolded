// Making a lesson (ARCHITECTURE.md sections 5.1 and 7): the paper is uploaded once with the
// Files API, Claude plans the lesson from it with structured output (validated, retried once
// by lib/pipeline/generate.ts), and the plan and the paper's file id are saved to the run
// folder. The fal cover (L4) isn't made here.
import "server-only";
import { randomUUID } from "node:crypto";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  type LessonPlan,
  LessonPlanOutput,
  LESSON_ID_RE,
} from "@/shared/lesson";
import type { ValidationResult } from "@/shared/validate";
import { config } from "@/lib/config";
import {
  claudeFiles,
  type ClaudeFiles,
  claudeMessages,
  type ClaudeMessages,
  GenerationError,
  generateWithRetry,
} from "@/lib/pipeline/generate";
import { PLAN_OUTPUT_FORMAT, schemaErrors } from "@/lib/pipeline/outputFormat";
import {
  PLAN_REQUEST_PROMPT,
  PLAN_SYSTEM_PROMPT,
  planRetryPrompt,
} from "@/lib/pipeline/prompts/plan";
import { writeRunJson } from "@/lib/runs/store";

/** The saved plan in a run folder (read by the lesson page). */
export const PLAN_FILE = "plan.json";
/** The paper's Files API id in a run folder, for the step requests. */
export const PAPER_FILE = "paper.json";

export const SavedPaper = z.object({
  fileId: z.string().min(1),
  /** The uploaded file's name, for people reading the run folder. */
  filename: z.string(),
});
export type SavedPaper = z.infer<typeof SavedPaper>;

/** The plan rule zod doesn't hold: at least config.plan.minSteps steps. */
export const tooFewSteps = (n: number) =>
  `too few steps (${n}, at least ${config.plan.minSteps})`;

/** Schema, then the step count. */
export function validatePlan(
  input: unknown,
): ValidationResult<LessonPlanOutput> {
  const parsed = LessonPlanOutput.safeParse(input);
  if (!parsed.success) return { ok: false, errors: schemaErrors(parsed.error) };
  const n = parsed.data.steps.length;
  return n < config.plan.minSteps
    ? { ok: false, errors: [tooFewSteps(n)] }
    : { ok: true, value: parsed.data };
}

/**
 * The plan request (pure). The paper is cached for 5 minutes, enough for the one retry: the
 * plan's system prompt and output format differ from a step's, so steps build their own cache.
 */
export function buildPlanRequest(
  paperFileId: string,
): Anthropic.MessageStreamParams {
  return {
    model: config.models.plan,
    max_tokens: config.plan.maxTokens,
    system: PLAN_SYSTEM_PROMPT,
    output_config: { effort: config.effort.plan, format: PLAN_OUTPUT_FORMAT },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "file", file_id: paperFileId },
            cache_control: { type: "ephemeral" },
          },
          { type: "text", text: PLAN_REQUEST_PROMPT },
        ],
      },
    ],
  };
}

/** Plans the lesson for an uploaded paper. Throws GenerationError. */
export async function generatePlan(
  paperFileId: string,
  messages: ClaudeMessages = claudeMessages(config.plan.fixture),
): Promise<LessonPlanOutput> {
  return generateWithRetry(
    {
      label: "plan",
      request: buildPlanRequest(paperFileId),
      validate: validatePlan,
      retryPrompt: planRetryPrompt,
      timeoutMs: config.plan.timeoutMs,
    },
    messages,
  );
}

/**
 * Uploads the paper with the Files API and returns its file id. Throws GenerationError
 * ("provider", with the SDK's error as its cause) when the upload fails or times out.
 */
export async function uploadPaper(
  bytes: Uint8Array,
  filename: string,
  files: ClaudeFiles = claudeFiles(config.plan.uploadFixture),
): Promise<string> {
  const file = await toFile(bytes, filename, { type: "application/pdf" });
  try {
    const uploaded = await files.upload(
      { file },
      { signal: AbortSignal.timeout(config.plan.timeoutMs) },
    );
    return uploaded.id;
  } catch (err) {
    if (!(err instanceof Anthropic.AnthropicError)) throw err;
    const what =
      err instanceof Anthropic.APIUserAbortError
        ? `timed out after ${config.plan.timeoutMs} ms`
        : `failed: ${err.name}: ${err.message}`;
    throw new GenerationError("provider", `paper upload ${what}`, [], {
      cause: err,
    });
  }
}

/** How many characters of the title go into a lesson id, before its random suffix. */
const ID_SLUG_CHARS = 30;

/** A new lesson id from the plan's title (pure): readable in runs/, unique by its suffix. */
export function newLessonId(title: string, suffix: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, ID_SLUG_CHARS)
    .replace(/^-+|-+$/g, "");
  const id = `${slug || "lesson"}-${suffix}`;
  if (!LESSON_ID_RE.test(id)) throw new Error(`bad lesson id: ${id}`);
  return id;
}

export interface Clients {
  files?: ClaudeFiles;
  messages?: ClaudeMessages;
}

/**
 * Uploads the paper, plans the lesson and saves the run folder: paper.json, then plan.json
 * last, so a lesson the page can open is always complete. Throws GenerationError
 * (`paperRejected` says when Claude refused the PDF itself), or a store error.
 */
export async function createLesson(
  pdf: { bytes: Uint8Array; filename: string },
  clients: Clients = {},
): Promise<{ lessonId: string; plan: LessonPlan }> {
  const fileId = await uploadPaper(pdf.bytes, pdf.filename, clients.files);
  const plan: LessonPlan = await generatePlan(fileId, clients.messages);
  const lessonId = newLessonId(plan.title, randomUUID().slice(0, 8));
  await writeRunJson(lessonId, PAPER_FILE, {
    fileId,
    filename: pdf.filename,
  } satisfies SavedPaper);
  await writeRunJson(lessonId, PLAN_FILE, plan);
  return { lessonId, plan };
}

/**
 * True when Claude refused the PDF itself (a 400 from the upload or the plan request: too
 * many pages, encrypted, unreadable), not when it failed to plan.
 */
export function paperRejected(err: unknown): boolean {
  return (
    err instanceof GenerationError &&
    err.cause instanceof Anthropic.BadRequestError
  );
}
