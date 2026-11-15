// A lesson's step for POST /api/lessons/<id>/steps/<n> (ARCHITECTURE.md sections 5.1, 6.2 and
// 7): served from runs/ once it's saved; otherwise written by Claude (G1), narrated (C1) and
// saved as a new step version with its audio (C2), its image objects illustrated by fal
// meanwhile (E1, lib/media/stepImages.ts). One generation per step at a time: a request
// while the step is generating waits for that generation, then is decided again from the run
// folder, so a signal that arrived meanwhile still gets a new version. The decisions are the
// pure section 6.2 machine in ./stepGeneration.ts and the adaptation rules in ./adaptation.ts;
// this file does the reads, writes and calls around them.
//
// Adaptation (section 5.4): a saved version made with an older signals version than
// signals.json's is stale, and a request regenerates it with the newer signals, unless the step
// has started playing; then the played version is served and never regenerated. A regeneration
// that fails is logged and keeps the older version.
//
// The in-flight generations live in this server process, which is enough for the one local
// server the app runs on (ARCHITECTURE.md section 1).
//
// In replay mode (REPLAY_RUN, section 5.5) the machine doesn't run: a step is served from the
// saved run (its played version, else its latest) or isn't there, and no provider is called.
import "server-only";
import { ZodError } from "zod";
import {
  EMPTY_SIGNALS,
  LessonPlan,
  MAX_PLAN_STEPS,
  SavedStep,
  type SignalsFile,
  type StepResponse,
} from "@/shared/lesson";
import { getEnv } from "@/lib/env";
import { illustrateStep } from "@/lib/media/stepImages";
import { narrate } from "@/lib/narration/tts";
import {
  adaptedFrom,
  isStale,
  playedVersion,
  signalsSince,
} from "@/lib/pipeline/adaptation";
import { readPaperPages } from "@/lib/pipeline/paperPages";
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
  readSignals,
  saveStepVersion,
  SIGNALS_FILE,
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
/**
 * lessonId/n -> the signals version its last regeneration failed with: the older version is
 * kept and served until a newer signal arrives (section 6.2, a regeneration that fails).
 */
const failedRegenerations = new Map<string, number>();

/** Tests only: forget every in-flight generation and remembered failure. */
export function resetStepRequestsForTests(): void {
  inFlight.clear();
  failedSteps.clear();
  failedRegenerations.clear();
}

const REQUEST: StepGenEvent = { type: "request" };

/** Step n of a lesson, generating it if it isn't saved. The lessonId is already checked. */
export function requestStep(lessonId: string, n: number): Promise<StepOutcome> {
  const key = `${lessonId}/${n}`;
  const running = inFlight.get(key);
  // generating x request: wait for this generation, never start a second one. Then decide
  // again: a signal that arrived while it ran makes its result stale (staleGenerating), and this
  // request regenerates it. A failure is the same failure for every waiter.
  if (running !== undefined && effectOf("generating", REQUEST) === "wait")
    return running.then((outcome) =>
      outcome.kind === "ok" ? requestStep(lessonId, n) : outcome,
    );
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
  /** The saved version a regeneration replaces, and the signals it is made with. */
  let replacing: StepResponse | undefined;
  let signals: SignalsFile = EMPTY_SIGNALS;
  try {
    const plan = await readRunJson(lessonId, PLAN_FILE, LessonPlan);
    if (plan === undefined) return { kind: "noSuchLesson" };
    if (n >= plan.steps.length) return { kind: "noSuchStep" };

    signals = await lessonSignals(lessonId);
    const played = playedVersion(signals.signals, n);
    // started: the played version is served, in replay mode too, and never regenerated.
    const playing = await playedStep(lessonId, n, signals);
    if (playing) return { kind: "ok", response: playing };

    const saved = await latestSavedStep(lessonId, n);
    if (getEnv().mode === "replay")
      return saved ? { kind: "ok", response: saved } : { kind: "notInRun" };
    const state = idleStepState(saved !== undefined, failedSteps.has(key));
    if (effectOf(state, REQUEST) === "serve" && saved) {
      const stale = isStale({
        savedWith: saved.signalsVersion,
        failedWith: failedRegenerations.get(key),
        current: signals.version,
        started: played !== undefined,
      });
      if (!stale) return { kind: "ok", response: saved };
      // ready x newer signal: a new version, made with the signals this one didn't see.
      replacing = saved;
      console.info(
        `${where}: regenerating v${saved.version} with signals version ${signals.version}`,
      );
    }
    if (state === "failed")
      console.info(`${where}: generating again after a failure`);

    const response = await generate(lessonId, n, plan, signals, replacing);
    settle(key, { type: "saved" });
    failedRegenerations.delete(key);
    return { kind: "ok", response };
  } catch (err) {
    const event = failureEvent(err);
    if (replacing !== undefined) {
      // A regeneration that fails keeps the older version (section 6.2, A1): the step stays
      // ready and playable, and isn't regenerated again until a newer signal.
      failedRegenerations.set(key, signals.version);
      console.error(
        `${where}: failed (${event?.type ?? "internal"}), keeping v${replacing.version}`,
        err,
      );
      // If a version started playing meanwhile, that one is the step now (started x failure).
      const playing = await playedStep(lessonId, n).catch(() => undefined);
      return { kind: "ok", response: playing ?? replacing };
    }
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

/**
 * Writes, narrates and saves step n as a new version, with the signals the version it replaces
 * (if any) didn't see. Throws when any part fails.
 */
async function generate(
  lessonId: string,
  n: number,
  plan: LessonPlan,
  signals: SignalsFile,
  replacing: StepResponse | undefined,
): Promise<StepResponse> {
  const paper = await readRunJson(lessonId, PAPER_FILE, SavedPaper);
  if (paper === undefined)
    throw new Error(`no ${PAPER_FILE}: the lesson's paper was never uploaded`);
  // The previous step as the learner heard it (its played version, else its latest). After a
  // jump it may not exist yet: the prompt then uses its goal.
  const previous =
    n > 0
      ? ((await playedStep(lessonId, n - 1, signals)) ??
        (await latestSavedStep(lessonId, n - 1)))
      : undefined;
  const newer = signalsSince(signals.signals, replacing?.signalsVersion ?? 0);
  const step = await generateStep({
    paperFileId: paper.fileId,
    plan,
    n,
    previousNarration: previous?.step.narration,
    signals: newer,
    paperPages: await readPaperPages(lessonId),
  });
  // The step's images (E1) are made alongside its narration, so they delay it only when they
  // outlast TTS; they never fail it.
  const [narrated, illustrated] = await Promise.all([
    narrate(step.narration),
    illustrateStep(lessonId, n, step),
  ]);
  // Only a regeneration says what it adapted to: a first version has nothing it replaces.
  const adapted = replacing && adaptedFrom(newer, n);
  const saved = SavedStep.parse({
    step: illustrated,
    cueTimes: narrated.cueTimes,
    signalsVersion: signals.version,
    ...(adapted && { adaptedFrom: adapted }),
  });
  if (replacing !== undefined) {
    // generating x started n: an older version started playing while this one was made, so
    // this one is discarded and the played version served. (A started signal arriving between
    // this check and the save lets the new version be saved; requests still get the played one.)
    const playing = await playedStep(lessonId, n);
    if (playing) {
      console.info(
        `${TAG} ${lessonId} step ${n}: v${playing.version} started while regenerating; discarded`,
      );
      return playing;
    }
  }
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
  return version === undefined ? undefined : savedStep(lessonId, n, version);
}

/** Version k of step n as the route answers it; undefined when it's missing or not a SavedStep (logged). */
async function savedStep(
  lessonId: string,
  n: number,
  version: number,
): Promise<StepResponse | undefined> {
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

/**
 * The version of step n that started playing last, as the route answers it; undefined if none
 * started or its file is missing or damaged. Reads signals.json unless it's given.
 */
async function playedStep(
  lessonId: string,
  n: number,
  signals?: SignalsFile,
): Promise<StepResponse | undefined> {
  const played = playedVersion(
    (signals ?? (await lessonSignals(lessonId))).signals,
    n,
  );
  return played === undefined ? undefined : savedStep(lessonId, n, played);
}

/**
 * The lesson's signals.json. One that isn't a SignalsFile is logged and read as no signals, so
 * the lesson stays playable (the signals route refuses to append to it).
 */
async function lessonSignals(lessonId: string): Promise<SignalsFile> {
  try {
    return await readSignals(lessonId);
  } catch (err) {
    if (!(err instanceof ZodError || err instanceof SyntaxError)) throw err;
    console.warn(
      `${TAG} ${lessonId}/${SIGNALS_FILE} is not a signals file`,
      err,
    );
    return EMPTY_SIGNALS;
  }
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
