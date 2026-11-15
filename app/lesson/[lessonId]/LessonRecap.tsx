// The end-of-lesson recap card (issue #130), in the dock above the tutor card: the ideas
// covered, the learner's questions and the steps adapted for them, each with a replay link
// (./recap.ts replayEvent). Close hides it until the lesson's end is reached again.
import { useId } from "react";
import type { PlayerEvent, PlayerState } from "@/player/machine";
import { RECAP_TEXT, type RecapView, replayEvent } from "./recap";
import styles from "./LessonRecap.module.css";

export function LessonRecap({
  view,
  state,
  send,
  onClose,
}: {
  view: RecapView;
  state: PlayerState;
  send: (event: PlayerEvent) => unknown;
  onClose: () => void;
}) {
  const titleId = useId();
  const replay = (n: number, title: string) => (
    <button
      type="button"
      className={styles.replay}
      aria-label={RECAP_TEXT.replayLabel(n, title)}
      data-testid="recap-replay"
      data-step={n}
      onClick={() => send(replayEvent(n, state))}
    >
      {RECAP_TEXT.replay}
    </button>
  );
  return (
    <section
      className={styles.panel}
      aria-labelledby={titleId}
      data-testid="lesson-recap"
    >
      <header className={styles.head}>
        <h3 id={titleId} className={styles.title}>
          {RECAP_TEXT.title}
        </h3>
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.close}
          aria-label={RECAP_TEXT.close}
          data-testid="recap-close"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className={styles.sections}>
        <section data-testid="recap-steps">
          <h4 className={styles.heading}>{view.coveredHeading}</h4>
          <ol className={styles.list}>
            {view.steps.map((s) => (
              <li key={s.n} className={styles.row} data-step={s.n}>
                <span className={styles.num}>{s.n + 1}</span>
                <span className={styles.text}>{s.title}</span>
                {s.adapted && (
                  <span className={styles.tag}>{RECAP_TEXT.adaptedTag}</span>
                )}
                {replay(s.n, s.title)}
              </li>
            ))}
          </ol>
        </section>
        <section data-testid="recap-questions">
          <h4 className={styles.heading}>{RECAP_TEXT.questions}</h4>
          {view.questions.length === 0 ? (
            <p className={styles.empty}>{RECAP_TEXT.noQuestions}</p>
          ) : (
            <ul className={styles.list}>
              {view.questions.map((q, i) => (
                <li key={i} className={styles.row} data-step={q.step}>
                  <span className={styles.text}>
                    “{q.text}”
                    {q.step !== undefined && (
                      <span className={styles.where}>
                        {" "}
                        · {RECAP_TEXT.atIdea(q.step)}
                      </span>
                    )}
                  </span>
                  {q.step !== undefined && replay(q.step, q.title ?? "")}
                </li>
              ))}
            </ul>
          )}
        </section>
        {view.adapted.length > 0 && (
          <section data-testid="recap-adapted">
            <h4 className={styles.heading}>{RECAP_TEXT.adapted}</h4>
            <ul className={styles.list}>
              {view.adapted.map((a) => (
                <li key={a.n} className={styles.row} data-step={a.n}>
                  <span className={styles.num}>{a.n + 1}</span>
                  <span className={styles.text}>
                    {a.title}
                    <span className={styles.because}>{a.because}</span>
                  </span>
                  {replay(a.n, a.title)}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </section>
  );
}
