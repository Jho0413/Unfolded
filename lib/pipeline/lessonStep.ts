// A lesson's step for POST /api/lessons/<id>/steps/<n> (ARCHITECTURE.md sections 5.1, 6.2 and
// 7): served from runs/ once it's saved; otherwise written by Claude (G1), narrated (C1) and
// saved as a new step version with its audio (C2). One generation per step at a time: a request
// while the step is generating waits for that generation. The decisions are the pure section
// 6.2 machine in ./stepGeneration.ts; this file does the reads, writes and calls around it.
//
// The in-flight generations live in this server process, which is enough for the one local
// server the app runs on (ARCHITECTURE.md section 1).
//
// In replay mode (REPLAY_RUN, section 5.5) the machine doesn't run: a step is served from the
// saved run or isn't there, and no provider is ever called.
import "server-only";
import { ZodError } from "zod";
import {
  LessonPlan,
  MAX_PLAN_STEPS,
  SavedStep,
  type StepResponse,
} from "@/shared/lesson";
import { getEnv } from "@/lib/env";
import { narrate } from "@/lib/narration/tts";
import { SavedPaper } from "@/lib/pipeline/plan";
import { generateStep } from "@/lib/pipeline/step";
import {
  failureEvent,
  idleStepState,
  type StepGenEvent,
  type StepGenState,
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
  /** Replay mode: the step has no saved file in the run. */
  | { kind: "notInRun" }
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

/** Tests only: forget every in-flight generation and remembered failure. */
export function resetStepRequestsForTests(): void {
  inFlight.clear();
  failedSteps.clear();
}

const REQUEST: StepGenEvent = { type: "request" };

/** Step n of a lesson, generating it if it isn't saved. The lessonId is already checked. */
export function requestStep(lessonId: string, n: number): Promise<StepOutcome> {
  const key = `${lessonId}/${n}`;
  const running = inFlight.get(key);
  // generating x request: wait for this generation, never start a second one.
  if (running !== undefined && effectOf("generating", REQUEST) === "wait")
    return running;
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
    // Replay serves the latest saved version: the played one (signals.json) comes with A1.
    if (getEnv().mode === "replay")
      return saved ? { kind: "ok", response: saved } : { kind: "notInRun" };
    const state = idleStepState(saved !== undefined, failedSteps.has(key));
    if (effectOf(state, REQUEST) === "serve" && saved)
      return { kind: "ok", response: saved };
    if (state === "failed")
      console.info(`${where}: generating again after a failure`);

    const response = await generate(lessonId, n, plan);
    settle(key, { type: "saved" });
    return { kind: "ok", response };
  } catch (err) {
    const event = failureEvent(err);
    // A failure outside the table (a bug, a failed save) fails the step too.
    if (event === undefined) failedSteps.add(key);
    else settle(key, event);
    console.error(`${where}: failed (${event?.type ?? "internal"})`, err);
    return { kind: "failed", status: event === undefined ? 500 : 502 };
  }
}

/** What section 6.2 does for this cell; undefined for a cell that can't happen. */
function effectOf(state: StepGenState, event: StepGenEvent) {
  const next = stepTransition(state, event);
  return next.outcome === "transition" ? next.effect : undefined;
}

/** Records where a generation's result leaves the step (section 6.2, generating x result). */
function settle(key: string, event: StepGenEvent): void {
  const next = stepTransition("generating", event);
  if (next.outcome === "transition" && next.to === "failed")
    failedSteps.add(key);
  else failedSteps.delete(key);
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

/**
 * The newest saved version of step n as the route answers it, or undefined if none is saved.
 * A newest file that isn't a SavedStep (damaged, or saved under an older contract) is logged
 * and counts as unsaved, so a request generates a new version instead of failing forever.
 */
async function latestSavedStep(
  lessonId: string,
  n: number,
): Promise<StepResponse | undefined> {
  const version = stepVersions(await listRunFiles(lessonId), n).at(-1);
  if (version === undefined) return undefined;
  const file = stepFileName(n, version);
  let saved: SavedStep | undefined;
  try {
    saved = await readRunJson(lessonId, file, SavedStep);
  } catch (err) {
    if (!(err instanceof ZodError || err instanceof SyntaxError)) throw err;
    console.warn(`${TAG} ${lessonId}/${file} is not a saved step`, err);
    return undefined;
  }
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
