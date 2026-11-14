"use client";
// The lesson outline (ARCHITECTURE.md section 5.6): the lesson's title and cover, one row per
// step (done, current, preparing, not ready), and the keyboard hints. A row goes to its step
// (the machine's goToStep); what each row shows is ./outlineRows.ts.
import { useState } from "react";
import type { PlayerEvent, PlayerState } from "@/player/machine";
import type { StepFetchStatus } from "@/player/prefetch";
import type { LessonPlan } from "@/shared/lesson";
import { outlineRows } from "./outlineRows";
import styles from "./lesson.module.css";

export function Outline({
  plan,
  coverSrc,
  current,
  state,
  statuses,
  send,
}: {
  plan: LessonPlan;
  coverSrc: string | null;
  current: number;
  state: PlayerState;
  statuses: readonly StepFetchStatus[];
  send: (event: PlayerEvent) => unknown;
}) {
  const rows = outlineRows(current, state, statuses);
  return (
    <nav className={styles.outline} aria-label="Lesson outline">
      <div className={styles.brand}>
        <i aria-hidden />
        Whiteboard
      </div>
      <div className={styles.paper}>
        {coverSrc !== null && <Cover src={coverSrc} />}
        <div>
          <div className={styles.paperKind}>Lesson</div>
          <h1 className={styles.paperTitle}>{plan.title}</h1>
        </div>
      </div>
      <ol className={styles.steps} data-testid="outline">
        {plan.steps.map((s, i) => {
          const row = rows[i];
          return (
            <li key={i}>
              <button
                type="button"
                className={styles.step}
                data-testid="outline-step"
                data-place={row.place}
                data-fetch={row.fetch}
                aria-current={row.place === "current" ? "step" : undefined}
                disabled={!row.clickable}
                onClick={() => send({ type: "goToStep", n: i })}
              >
                <span className={styles.num} aria-hidden>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className={styles.stepTitle}>{s.title}</span>
                {row.label !== null && (
                  <span className={styles.stepLabel}>{row.label}</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      <p className={styles.keys}>
        <kbd>Space</kbd> hold on / go on
        <br />
        <kbd>→</kbd> next idea · <kbd>←</kbd> back · <kbd>R</kbd> again
        <br />
        <kbd>A</kbd> ask by voice
      </p>
    </nav>
  );
}

/** Page chrome, not a board object (ARCHITECTURE.md section 5.1). Hidden if it won't load. */
function Cover({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // A run file served by our own route: next/image's optimiser would only add a copy.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      data-testid="lesson-cover"
      className={styles.cover}
      onError={() => setFailed(true)}
      // The server-rendered image can fail before hydration, when React isn't listening yet.
      ref={(img) => {
        if (img?.complete && img.naturalWidth === 0) setFailed(true);
      }}
    />
  );
}
