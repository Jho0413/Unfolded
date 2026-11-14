// Lesson plan and API request/response schemas (ARCHITECTURE.md sections 3,
// 5 and 8). Imported by the server and the browser: no node-only imports.
import { z } from "zod";
import { BoardState, Sketch, Step } from "./scene";

/** `lessonId` in routes and run folders (ARCHITECTURE.md section 7). */
export const LESSON_ID_RE = /^[a-z0-9-]{1,40}$/;
/**
 * File names in a run folder (ARCHITECTURE.md section 5.1). The first character can't be a
 * dot, so "." and ".." are never names, and the length stays well under the OS limit.
 */
export const RUN_FILE_RE = /^[a-z0-9][a-z0-9.-]{0,99}$/;

export const LessonId = z.string().regex(LESSON_ID_RE);
export type LessonId = z.infer<typeof LessonId>;

export const RunFileName = z.string().regex(RUN_FILE_RE);

/** True for `/api/runs/<lessonId>/<file>`, with both parts following the rules above. */
export function isRunFileUrl(url: string): boolean {
  const m = /^\/api\/runs\/([^/]+)\/([^/]+)$/.exec(url);
  return m !== null && LESSON_ID_RE.test(m[1]) && RUN_FILE_RE.test(m[2]);
}

export const MAX_PLAN_STEPS = 12;

export const PlanStep = z.object({
  title: z.string().min(1),
  /** What this step teaches. Sent to the step prompt and used for context after a jump. */
  goal: z.string().min(1),
});
export type PlanStep = z.infer<typeof PlanStep>;

/** What Claude writes for a plan (structured output). */
export const LessonPlanOutput = z.object({
  title: z.string().min(1),
  steps: z.array(PlanStep).min(1).max(MAX_PLAN_STEPS),
  /** Prompt for the one fal cover illustration (L4). */
  coverPrompt: z.string().min(1),
});
export type LessonPlanOutput = z.infer<typeof LessonPlanOutput>;

/** The saved plan (`runs/<id>/plan.json`) and the plan in API responses. */
export const LessonPlan = LessonPlanOutput.extend({
  /** File name of the cover in the run folder. Absent when fal was slow, failed or has no key. */
  cover: RunFileName.optional(),
});
export type LessonPlan = z.infer<typeof LessonPlan>;

// ---------------------------------------------------------------- API

/** Any route's error body. */
export const ApiError = z.object({ error: z.string() });
export type ApiError = z.infer<typeof ApiError>;

/** POST /api/lessons */
export const CreateLessonResponse = z.object({
  lessonId: LessonId,
  plan: LessonPlan,
});
export type CreateLessonResponse = z.infer<typeof CreateLessonResponse>;

/** Cue name -> time in ms from the start of the step's audio. */
export const CueTimes = z.record(z.string(), z.number().min(0));
export type CueTimes = z.infer<typeof CueTimes>;

/** POST /api/lessons/:id/steps/:n */
export const StepResponse = z.object({
  step: Step,
  /** Step version `k` (step-<n>.v<k>.json), reported back in the "started" signal. */
  version: z.number().int().min(1),
  /** Served by GET /api/runs/<lessonId>/<file>, never a model-written URL. */
  audioUrl: z
    .string()
    .refine(
      (url) => isRunFileUrl(url) && url.endsWith(".mp3"),
      "not a /api/runs/<lessonId>/<file>.mp3 URL",
    ),
  cueTimes: CueTimes,
});
export type StepResponse = z.infer<typeof StepResponse>;

/**
 * POST /api/sketch body. The server adds the `config.maxBoardObjects` cap on
 * `board.objects` (it lives in server-only lib/config.ts).
 */
export const SketchRequest = z.object({
  description: z.string().min(1),
  fresh: z.boolean().default(false),
  board: BoardState,
});
export type SketchRequest = z.infer<typeof SketchRequest>;

export const SketchResponse = z.object({ sketch: Sketch });
export type SketchResponse = z.infer<typeof SketchResponse>;

/** POST /api/lessons/:id/signals body (ARCHITECTURE.md section 5.4). Strict, so a body never matches two kinds. */
export const Signal = z.union([
  z.strictObject({ question: z.string().min(1) }),
  z.strictObject({ simplify: z.string().min(1) }),
  z.strictObject({
    started: z.number().int().min(0),
    version: z.number().int().min(1),
  }),
]);
export type Signal = z.infer<typeof Signal>;

/** What Ask shows when the token route fails or the agent can't connect (ARCHITECTURE.md section 7). */
export const QA_UNAVAILABLE = "Questions are unavailable right now.";

/** GET /api/agent/token. On failure: 503 (not set up), 502 (ElevenLabs failed) or 500, all with `{ error: QA_UNAVAILABLE }`. */
export const AgentTokenResponse = z.object({
  conversationToken: z.string().min(1),
});
export type AgentTokenResponse = z.infer<typeof AgentTokenResponse>;

/**
 * A saved step file, `runs/<id>/step-<n>.v<k>.json` (ARCHITECTURE.md section 5.1): the step and
 * its cue times. Its version and audio (`step-<n>.v<k>.mp3`) come from the file name, so the
 * lesson page can rebuild the StepResponse from the run folder alone.
 */
export const SavedStep = z.object({ step: Step, cueTimes: CueTimes });
export type SavedStep = z.infer<typeof SavedStep>;

/** A bad `lessonId`, or a lesson with no saved plan (ARCHITECTURE.md section 7). */
export const NO_SUCH_LESSON = "No such lesson or step.";

/** A step that has no saved file in the run (ARCHITECTURE.md sections 5.5 and 7). */
export const STEP_NOT_IN_RUN = "This step isn't in the saved run.";
