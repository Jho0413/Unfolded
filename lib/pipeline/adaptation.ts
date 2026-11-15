// Adaptation's decisions (ARCHITECTURE.md section 5.4 and the A1 cells of section 6.2), pure:
// which version of a step the route serves once it has started, whether a saved version is
// stale, which signals a regeneration gets, and what it records as adaptedFrom. The step route
// (lib/pipeline/lessonStep.ts) reads signals.json and the step files and acts on these.
import "server-only";
import type { AdaptedFrom, Signal } from "@/shared/lesson";

/** A question or a simplify request: the signals that count towards the signals version. */
export type LearnerSignal =
  Extract<Signal, { question: string }> | Extract<Signal, { simplify: string }>;

const isLearnerSignal = (s: Signal): s is LearnerSignal =>
  "question" in s || "simplify" in s;

/** The version of step n that started playing last, or undefined if it never started. */
export function playedVersion(
  signals: readonly Signal[],
  n: number,
): number | undefined {
  let played: number | undefined;
  for (const s of signals)
    if ("started" in s && s.started === n) played = s.version;
  return played;
}

export interface Staleness {
  /** The signals version the saved version was made with (absent: made before signals). */
  savedWith: number | undefined;
  /**
   * The signals version a regeneration of this step tried and failed with, if one did: the
   * older version is kept (section 6.2), and isn't regenerated again until a newer signal.
   */
  failedWith: number | undefined;
  /** The lesson's signals version now (signals.json). */
  current: number;
  /** A version of the step has started playing. */
  started: boolean;
}

/**
 * Section 6.2 `ready x newer signal`: a saved version is stale, and is regenerated, when the
 * lesson has newer signals than it was made with and the step hasn't started playing. A
 * started step is never regenerated (`started x newer signal`: ignored, already heard).
 */
export function isStale({
  savedWith,
  failedWith,
  current,
  started,
}: Staleness): boolean {
  return !started && Math.max(savedWith ?? 0, failedWith ?? 0) < current;
}

/**
 * The questions and simplify requests past the first `version` of them, oldest first: those a
 * step made with signals version `version` didn't see.
 */
export function signalsSince(
  signals: readonly Signal[],
  version: number,
): LearnerSignal[] {
  return signals.filter(isLearnerSignal).slice(version);
}

/**
 * What a regenerated version of step n records as adaptedFrom: the newest of the signals it
 * used that the version it replaces didn't see. Undefined when there are none.
 */
export function adaptedFrom(
  newer: readonly LearnerSignal[],
  n: number,
): AdaptedFrom | undefined {
  const newest = newer.at(-1);
  if (newest === undefined) return undefined;
  // The browser always sends `step`; an older signal without it is placed at the step it adapts.
  const atStep = newest.step ?? n;
  return "question" in newest
    ? { kind: "question", text: newest.question, atStep }
    : { kind: "simplify", text: newest.simplify, atStep };
}
