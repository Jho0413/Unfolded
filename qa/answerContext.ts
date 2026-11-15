// What the Q&A agent is told when the Answer view (ARCHITECTURE.md sections 5.6 and 8) opens,
// changes or closes, so it knows whether the learner sees the lesson or a drawn answer (for
// "go back" and "say that again"). Sent as contextual updates through the Ask panel's
// tellAgent (sendContextualUpdate). One place for the wording, which the agent's context
// builder can reuse.

export const ANSWER_CONTEXT = {
  /** A drawn answer is on screen instead of the lesson; `what` is what the agent asked for. */
  showing: (what: string) => `Answer board showing: ${what}`,
  /**
   * What the lesson's narrator says over a drawn answer (#105), so the agent knows those words
   * if they leak back through the mic: they're the narration, not the learner.
   */
  narrating: (said: string) =>
    `The lesson's narrator is reading this answer aloud (not the learner): "${said}"`,
  /** The drawn answer is gone and the lesson board is back. */
  back: "Back on the lesson.",
} as const;

/** A change to what's on the board: a drawn answer arrived, or Ask closed. */
export type AnswerChange =
  | { kind: "drawn"; description: string; narration?: string }
  | { kind: "closed" };

/**
 * The update for a change, given whether the Answer view was up before it (pure). A drawing
 * opens or replaces it; closing Ask from it goes back to the lesson; closing Ask from the
 * lesson says nothing.
 */
export function answerContextUpdate(
  wasShowing: boolean,
  change: AnswerChange,
): string | null {
  if (change.kind === "drawn")
    return change.narration === undefined
      ? ANSWER_CONTEXT.showing(change.description)
      : `${ANSWER_CONTEXT.showing(change.description)}\n${ANSWER_CONTEXT.narrating(change.narration)}`;
  return wasShowing ? ANSWER_CONTEXT.back : null;
}

/** Tells the agent about a change, if there's anything to tell. */
export function tellAnswerContext(
  tell: (text: string) => void,
  wasShowing: boolean,
  change: AnswerChange,
): void {
  const update = answerContextUpdate(wasShowing, change);
  if (update !== null) tell(update);
}
