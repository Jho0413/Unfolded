// Making a lesson (ARCHITECTURE.md sections 5.1 and 7): the paper is uploaded once with the
// Files API, Claude plans the lesson from it with structured output (validated, retried once
// by lib/pipeline/generate.ts), the fal cover is made from its coverPrompt (L4,
// lib/media/cover.ts), and the plan and the paper's file id are saved to the run folder.
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
  providerError,
} from "@/lib/pipeline/generate";
import { addCover } from "@/lib/media/cover";
import type { ImageMaker } from "@/lib/media/fal";
import { PLAN_OUTPUT_FORMAT, schemaErrors } from "@/lib/pipeline/outputFormat";
import {
  PLAN_REQUEST_PROMPT,
  PLAN_SYSTEM_PROMPT,
  planRetryPrompt,
} from "@/lib/pipeline/prompts/plan";
import { PAPER_FILE, PLAN_FILE, writeRunJson } from "@/lib/runs/store";

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
    throw providerError(err, "paper upload", config.plan.timeoutMs);
  }
}

/** How many characters of the title go into a lesson id, before its random suffix. */
const ID_SLUG_CHARS = 30;
/** Random hex characters at the end of a lesson id: 4 billion ids per title. */
const ID_SUFFIX_CHARS = 8;

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
  /** fal for the cover; by default falImages() (none without FAL_KEY). */
  images?: ImageMaker;
}

/**
 * Uploads the paper, plans the lesson and saves the run folder: paper.json, the cover (waited
 * for up to config.cover.timeoutMs, and left out if it fails), then plan.json last, so a
 * lesson the page can open is always complete. Throws GenerationError
 * (`paperRejected` says when Claude refused the PDF itself), or a store error.
 */
export async function createLesson(
  pdf: { bytes: Uint8Array; filename: string },
  clients: Clients = {},
): Promise<{ lessonId: string; plan: LessonPlan }> {
  // A paper whose plan then fails stays in the Files API: a hackathon-sized cost, not cleaned up.
  const fileId = await uploadPaper(pdf.bytes, pdf.filename, clients.files);
  const output = await generatePlan(fileId, clients.messages);
  const lessonId = newLessonId(
    output.title,
    randomUUID().slice(0, ID_SUFFIX_CHARS),
  );
  await writeRunJson(lessonId, PAPER_FILE, {
    fileId,
    filename: pdf.filename,
  } satisfies SavedPaper);
  const plan = await addCover(lessonId, output, clients.images);
  await writeRunJson(lessonId, PLAN_FILE, plan);
  return { lessonId, plan };
}

/**
 * True when Claude refused the PDF itself (a 400 from the upload or the plan request: too
 * many pages, encrypted, unreadable, too long), not when it failed to plan. A 400 can also be
 * our own request's fault (a bad parameter or schema), which this can't tell apart without
 * matching error text; such a bug shows the learner the PDF message, and the log has the cause.
 */
export function paperRejected(err: unknown): boolean {
  return (
    err instanceof GenerationError &&
    err.cause instanceof Anthropic.BadRequestError
  );
}
