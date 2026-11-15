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

/** The learner signal a regenerated step was adapted to (ARCHITECTURE.md section 5.4). */
export const AdaptedFrom = z.object({
  kind: z.enum(["question", "simplify"]),
  /** The question, or simplify_upcoming's reason. */
  text: z.string().min(1),
  /** The step on screen when the signal was sent (0-based). */
  atStep: z.number().int().min(0),
});
export type AdaptedFrom = z.infer<typeof AdaptedFrom>;

/**
 * A saved step file, `runs/<id>/step-<n>.v<k>.json` (ARCHITECTURE.md section 5.1): the step and
 * its cue times. Its version and audio (`step-<n>.v<k>.mp3`) come from the file name, so the
 * lesson page can rebuild the StepResponse from the run folder alone.
 */
export const SavedStep = z.object({
  step: Step,
  cueTimes: CueTimes,
  /** The signals version this generation used (section 5.4). Absent in older runs. */
  signalsVersion: z.number().int().min(0).optional(),
  /**
   * Set by the server on a regenerated version (k > 1) that used newer signals than the version
   * it replaces: the newest of those signals. The player shows "Updated because you asked…".
   */
  adaptedFrom: AdaptedFrom.optional(),
});
export type SavedStep = z.infer<typeof SavedStep>;

/** POST /api/lessons/:id/steps/:n */
export const StepResponse = SavedStep.extend({
  /** Step version `k` (step-<n>.v<k>.json), reported back in the "started" signal. */
  version: z.number().int().min(1),
  /** Served by GET /api/runs/<lessonId>/<file>, never a model-written URL. */
  audioUrl: z
    .string()
    .refine(
      (url) => isRunFileUrl(url) && url.endsWith(".mp3"),
      "not a /api/runs/<lessonId>/<file>.mp3 URL",
    ),
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

/**
 * Where the learner was when a question or simplify signal was sent: the step on screen
 * (0-based) and ms into its audio. Optional so older signals still parse; the browser sends both.
 */
const SignalAt = {
  step: z.number().int().min(0).optional(),
  t: z.number().min(0).optional(),
};

const QuestionSignal = z.strictObject({
  question: z.string().min(1),
  ...SignalAt,
});
/** From simplify_upcoming: its `reason`. It targets the step after `step`. */
const SimplifySignal = z.strictObject({
  simplify: z.string().min(1),
  ...SignalAt,
});
/** Version `version` of step `started` starts playing. */
const StartedSignal = z.strictObject({
  started: z.number().int().min(0),
  version: z.number().int().min(1),
});

/** POST /api/lessons/:id/signals body (ARCHITECTURE.md section 5.4). Strict, so a body never matches two kinds. */
export const Signal = z.union([QuestionSignal, SimplifySignal, StartedSignal]);
export type Signal = z.infer<typeof Signal>;

/** POST /api/lessons/:id/signals answer: the signals version after the append. */
export const SignalResponse = z.object({ version: z.number().int().min(0) });
export type SignalResponse = z.infer<typeof SignalResponse>;

/** One signal in signals.json, with the server's time it arrived (ISO 8601). */
const at = { at: z.iso.datetime() };
export const RecordedSignal = z.union([
  QuestionSignal.extend(at),
  SimplifySignal.extend(at),
  StartedSignal.extend(at),
]);
export type RecordedSignal = z.infer<typeof RecordedSignal>;

/**
 * `runs/<id>/signals.json` (section 5.4). `version` counts the question and simplify signals:
 * a "started" one is recorded but never bumps it, as it makes no step stale.
 */
export const SignalsFile = z.object({
  version: z.number().int().min(0),
  signals: z.array(RecordedSignal),
});
export type SignalsFile = z.infer<typeof SignalsFile>;

/** signals.json before any signal arrives (no file yet). */
export const EMPTY_SIGNALS: SignalsFile = { version: 0, signals: [] };

/** The signals version a list of signals gives: one per question or simplify signal. */
export function signalsVersion(signals: readonly Signal[]): number {
  return signals.filter((s) => "question" in s || "simplify" in s).length;
}

/** What Ask shows when the token route fails or the agent can't connect (ARCHITECTURE.md section 7). */
export const QA_UNAVAILABLE = "Questions are unavailable right now.";

/** What Ask shows when a `draw_scene` sketch fails, and the error POST /api/sketch returns (ARCHITECTURE.md section 7). */
export const SKETCH_FAILED = "Couldn't draw that.";

/** GET /api/agent/token. On failure: 503 (not set up), 502 (ElevenLabs failed) or 500, all with `{ error: QA_UNAVAILABLE }`. */
export const AgentTokenResponse = z.object({
  conversationToken: z.string().min(1),
});
export type AgentTokenResponse = z.infer<typeof AgentTokenResponse>;

/** GET /api/agent/signed-url, the websocket fallback's signed URL. Fails like GET /api/agent/token. */
export const AgentSignedUrlResponse = z.object({
  signedUrl: z.string().min(1),
});
export type AgentSignedUrlResponse = z.infer<typeof AgentSignedUrlResponse>;

/** A bad `lessonId`, or a lesson with no saved plan (ARCHITECTURE.md section 7). */
export const NO_SUCH_LESSON = "No such lesson or step.";

/** A step that has no saved file in the run (ARCHITECTURE.md sections 5.5 and 7). */
export const STEP_NOT_IN_RUN = "This step isn't in the saved run.";
