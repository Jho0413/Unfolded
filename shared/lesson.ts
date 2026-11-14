// Lesson plan and API request/response schemas (ARCHITECTURE.md sections 3,
// 5 and 8). Imported by the server and the browser: no node-only imports.
import { z } from "zod";
import { BoardState, Sketch, Step } from "./scene";

/** `lessonId` in routes and run folders (ARCHITECTURE.md section 7). */
export const LESSON_ID_RE = /^[a-z0-9-]{1,40}$/;
/** File names served from a run folder (ARCHITECTURE.md section 5.1). */
export const RUN_FILE_RE = /^[a-z0-9.-]+$/;

export const LessonId = z.string().regex(LESSON_ID_RE);
export type LessonId = z.infer<typeof LessonId>;

export const RunFileName = z.string().regex(RUN_FILE_RE);

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
  audioUrl: z.string().regex(/^\/api\/runs\/[a-z0-9-]{1,40}\/[a-z0-9.-]+$/),
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

/** POST /api/lessons/:id/signals body (ARCHITECTURE.md section 5.4). */
export const Signal = z.union([
  z.object({ question: z.string().min(1) }),
  z.object({ simplify: z.string().min(1) }),
  z.object({
    started: z.number().int().min(0),
    version: z.number().int().min(1),
  }),
]);
export type Signal = z.infer<typeof Signal>;

/** GET /api/agent/token */
export const AgentTokenResponse = z.object({
  conversationToken: z.string().min(1),
});
export type AgentTokenResponse = z.infer<typeof AgentTokenResponse>;
