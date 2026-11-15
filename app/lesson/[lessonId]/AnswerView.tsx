"use client";
// The Answer view (ARCHITECTURE.md section 5.6): the drawn answer on a clean board, in the
// lesson's own look, with a small "Answer" tag (the card's answer tag) and a "Back to step N"
// chip in the board's top corners. The board passed in holds only the drawing: the lesson is
// hidden, not dimmed. ./boardView.ts decides when it shows. `data-clear-of-dock` makes the stage
// keep the whole answer above the tutor card and Ask box (player/Player.module.css).
import type { BoardState } from "@/shared/scene";
import { Whiteboard } from "@/player/Whiteboard";
import cardStyles from "@/player/TutorCard.module.css";
import { ANSWER_VIEW_TEXT } from "./boardView";
import styles from "./AnswerView.module.css";

export function AnswerView({
  board,
  backTo,
  onBack,
}: {
  /** The drawing, on its own board. */
  board: BoardState;
  /** The step the lesson returns to (0-based). */
  backTo: number;
  /** The chip: back to the lesson, paused where the learner was. */
  onBack: () => void;
}) {
  return (
    <div data-testid="answer-view" data-clear-of-dock className={styles.view}>
      <Whiteboard state={board} />
      <span
        data-testid="answer-view-tag"
        className={`${cardStyles.tag} ${styles.tag}`}
      >
        {ANSWER_VIEW_TEXT.tag}
      </span>
      <button
        type="button"
        data-testid="answer-view-back"
        className={`${cardStyles.button} ${styles.back}`}
        onClick={onBack}
      >
        {ANSWER_VIEW_TEXT.back(backTo + 1)}
      </button>
    </div>
  );
}
