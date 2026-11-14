// A lesson's step for POST /api/lessons/<id>/steps/<n> (ARCHITECTURE.md sections 5.1, 6.2 and
// 7): served from runs/ once it's saved; otherwise written by Claude (G1), narrated (C1) and
// saved as a new step version with its audio (C2). One generation per step at a time: a request
// while the step is generating waits for that generation. The decisions are the pure section
// 6.2 machine in ./stepGeneration.ts; this file does the reads, writes and calls around it.
//
// The in-flight generations live in this server process, which is enough for the one local
// server the app runs on (ARCHITECTURE.md section 1).
import "server-only";
import {
  LessonPlan,
  MAX_PLAN_STEPS,
  SavedStep,
  type StepResponse,
} from "@/shared/lesson";
import { narrate } from "@/lib/narration/tts";
import { SavedPaper } from "@/lib/pipeline/plan";
import { generateStep } from "@/lib/pipeline/step";
import {
  failureEvent,
  idleStepState,
  stepTransition,
} from "@/lib/pipeline/stepGeneration";
import {
  listRunFiles,
  PAPER_FILE,
  PLAN_FILE,
  readRunJson,
  saveStepVersion,
  stepAudioFileName,
  stepFileName,
  stepVersions,
} from "@/lib/runs/store";

/** Server log tag: the route; each line adds the lesson and the step. */
const TAG = "[api/lessons/steps]";

export type StepOutcome =
  | { kind: "ok"; response: StepResponse }
  /** The lesson has no plan.json. */
  | { kind: "noSuchLesson" }
  /** n is past the plan's last step. */
  | { kind: "noSuchStep" }
  /** Logged. 502: Claude or TTS failed (a section 6.2 cause); 500: anything else. */
  | { kind: "failed"; status: 502 | 500 };

/**
 * The step number in the route (0-based), or undefined unless it's a plain decimal that could
 * be a plan step (below MAX_PLAN_STEPS). Whether the plan has it is checked against the plan.
 */
export function parseStepNumber(raw: string): number | undefined {
  if (!/^(0|[1-9]\d*)$/.test(raw)) return undefined;
  const n = Number(raw);
  return n < MAX_PLAN_STEPS ? n : undefined;
}

/** lessonId/n -> the request that is generating it (section 6.2 `generating`). */
const inFlight = new Map<string, Promise<StepOutcome>>();
/** Steps whose last generation failed (section 6.2 `failed`), until one succeeds. */
const failedSteps = new Set<string>();

/** Step n of a lesson, generating it if it isn't saved. The lessonId is already checked. */
export function requestStep(lessonId: string, n: number): Promise<StepOutcome> {
  const key = `${lessonId}/${n}`;
  const running = inFlight.get(key);
  // generating x request: wait for this generation, never start a second one.
  if (running !== undefined) return running;
  // Registered before the first await, so a request arriving while this one reads the run
  // folder joins it instead of starting its own generation.
  const outcome = resolveStep(lessonId, n, key).finally(() =>
    inFlight.delete(key),
  );
  inFlight.set(key, outcome);
  return outcome;
}

async function resolveStep(
  lessonId: string,
  n: number,
  key: string,
): Promise<StepOutcome> {
  const where = `${TAG} ${lessonId} step ${n}`;
  try {
    const plan = await readRunJson(lessonId, PLAN_FILE, LessonPlan);
    if (plan === undefined) return { kind: "noSuchLesson" };
    if (n >= plan.steps.length) return { kind: "noSuchStep" };

    const saved = await latestSavedStep(lessonId, n);
    const state = idleStepState(saved !== undefined, failedSteps.has(key));
    const next = stepTransition(state, { type: "request" });
    if (next.outcome === "transition" && next.effect === "serve" && saved)
      return { kind: "ok", response: saved };
    if (state === "failed")
      console.info(`${where}: generating again after a failure`);

    const response = await generate(lessonId, n, plan);
    failedSteps.delete(key);
    return { kind: "ok", response };
  } catch (err) {
    failedSteps.add(key);
    const event = failureEvent(err);
    console.error(`${where}: failed (${event?.type ?? "internal"})`, err);
    return { kind: "failed", status: event === undefined ? 500 : 502 };
  }
}

/** Writes, narrates and saves step n as a new version. Throws when any part fails. */
async function generate(
  lessonId: string,
  n: number,
  plan: LessonPlan,
): Promise<StepResponse> {
  const paper = await readRunJson(lessonId, PAPER_FILE, SavedPaper);
  if (paper === undefined)
    throw new Error(`no ${PAPER_FILE}: the lesson's paper was never uploaded`);
  // After a jump the previous step may not exist yet: the prompt then uses its goal.
  const previous = n > 0 ? await latestSavedStep(lessonId, n - 1) : undefined;
  const step = await generateStep({
    paperFileId: paper.fileId,
    plan,
    n,
    previousNarration: previous?.step.narration,
    // Learner signals arrive with adaptation (A1, section 5.4).
    signals: [],
  });
  const narrated = await narrate(step.narration);
  const saved = SavedStep.parse({ step, cueTimes: narrated.cueTimes });
  const version = await saveStepVersion(lessonId, n, saved, narrated.audio);
  return stepResponse(lessonId, n, version, saved);
}

/** The newest saved version of step n as the route answers it, or undefined if none is saved. */
async function latestSavedStep(
  lessonId: string,
  n: number,
): Promise<StepResponse | undefined> {
  const version = stepVersions(await listRunFiles(lessonId), n).at(-1);
  if (version === undefined) return undefined;
  const saved = await readRunJson(
    lessonId,
    stepFileName(n, version),
    SavedStep,
  );
  return saved && stepResponse(lessonId, n, version, saved);
}

function stepResponse(
  lessonId: string,
  n: number,
  version: number,
  saved: SavedStep,
): StepResponse {
  return {
    ...saved,
    version,
    audioUrl: `/api/runs/${lessonId}/${stepAudioFileName(n, version)}`,
  };
}
