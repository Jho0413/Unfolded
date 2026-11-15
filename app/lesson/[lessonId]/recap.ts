// The end-of-lesson recap (issue #130): once the last step ends, a card lists the ideas the
// learner played, the questions they asked, and the steps regenerated for them (#102), each
// with a replay link to its step. Pure: ./useLessonRecap.ts gathers what happened in the
// browser (no generator, no new route) and ./LessonRecap.tsx draws it.
import type { AdaptedFrom, Signal } from "@/shared/lesson";
import { adaptedMarker } from "@/player/adapted";
import { ideaTitle } from "@/player/cardView";
import type { PlayerEvent, PlayerState } from "@/player/machine";

export const RECAP_TEXT = {
  title: "Lesson recap",
  close: "Close the recap",
  covered: (played: number, total: number) =>
    played === total
      ? `Ideas covered (all ${total})`
      : `Ideas covered (${played} of ${total})`,
  questions: "Your questions",
  adapted: "Adapted for you",
  adaptedTag: "Adapted",
  noQuestions: "No questions this time. Ask about any idea after a replay.",
  replay: "Replay",
  replayLabel: (n: number, title: string) => `Replay idea ${n + 1}: ${title}`,
  atIdea: (n: number) => `idea ${n + 1}`,
} as const;

/** A question the learner asked, and the step on screen when they asked it (0-based; Ask's
 * signals always say, but the contract lets a signal leave it out). */
export type RecapQuestion = { text: string; step?: number };

/** What happened this session, as ./useLessonRecap.ts records it. */
export type RecapInput = {
  /** The plan's step titles. */
  titles: readonly string[];
  /** Steps that started playing this session (0-based, any order, repeats allowed). */
  played: Iterable<number>;
  /** Question signals posted this session, oldest first. */
  questions: readonly RecapQuestion[];
  /** Per step, what the version it last played was adapted to (only adapted ones). */
  adapted: ReadonlyMap<number, AdaptedFrom>;
};

export type RecapStep = { n: number; title: string; adapted: boolean };
export type RecapAdapted = {
  n: number;
  title: string;
  /** "Updated because you asked: “…”" or "Made simpler because you asked". */
  because: string;
};

export type RecapView = {
  /** The heading over the covered ideas. */
  coveredHeading: string;
  steps: RecapStep[];
  /** `title` is the step's it was asked on, when known. */
  questions: (RecapQuestion & { title?: string })[];
  adapted: RecapAdapted[];
};

export function recapView(input: RecapInput): RecapView {
  const { titles } = input;
  const title = (n: number) => ideaTitle(titles, n);
  const played = [...new Set(input.played)]
    .filter((n) => n >= 0 && n < titles.length)
    .sort((a, b) => a - b);
  const adapted = [...input.adapted.entries()]
    .filter(([n]) => played.includes(n))
    .sort(([a], [b]) => a - b)
    .map(([n, from]) => {
      const marker = adaptedMarker(from)!;
      return {
        n,
        title: title(n),
        because:
          marker.quote === null
            ? marker.lead
            : `${marker.lead} “${marker.quote}”`,
      };
    });
  return {
    coveredHeading: RECAP_TEXT.covered(played.length, titles.length),
    steps: played.map((n) => ({
      n,
      title: title(n),
      adapted: input.adapted.has(n),
    })),
    questions: input.questions.map((q) =>
      q.step === undefined ? q : { ...q, title: title(q.step) },
    ),
    adapted,
  };
}

/** The recap shows at the lesson's end: the last step ended, or the lesson finished. */
export function atLessonEnd(state: PlayerState, stepCount: number): boolean {
  return (
    state.kind === "finished" ||
    (state.kind === "stepEnded" && state.step >= stepCount - 1)
  );
}

/** A replay link: the step on screen again from its start, or a jump to an earlier one. */
export function replayEvent(n: number, state: PlayerState): PlayerEvent {
  return state.kind !== "asking" && state.step === n
    ? { type: "replay" }
    : { type: "goToStep", n };
}

/** A posted signal's question, if it is one (simplify requests show as adapted steps). */
export function recapQuestion(signal: Signal): RecapQuestion | null {
  return "question" in signal
    ? {
        text: signal.question,
        ...(signal.step !== undefined && { step: signal.step }),
      }
    : null;
}
