"use client";
// The upload page's right side (ARCHITECTURE.md section 5.1): a miniature of the lesson page
// (the outline, the board with the tutor card, the PDF beside it), slightly tilted. Idle, the
// board draws a sample step through the real renderer; while planning, the outline is a
// skeleton; once planned, it shows the plan and faces the learner. Hidden on phones.
import { type CSSProperties, useEffect, useState } from "react";
import { sceneAt, timeline } from "@/player/sceneAt";
import { stepView } from "@/player/viewport";
import { Whiteboard } from "@/player/Whiteboard";
import styles from "./home.module.css";
import { SAMPLE_CUE_TIMES, SAMPLE_STEP } from "./previewScene";
import type { PreviewView } from "./uploadFlow";

const TIMED = timeline(SAMPLE_STEP.actions, SAMPLE_CUE_TIMES);
const END_MS = Math.max(...TIMED.map((t) => t.startMs + t.durationMs));
const VIEW = stepView(SAMPLE_STEP);

/** Lines of the miniature PDF; the highlighted ones are a quote the step points at. */
const PDF_LINES = [
  "title",
  "",
  "",
  "short",
  "quote",
  "quoteEnd",
  "",
  "",
  "long",
  "",
  "half",
] as const;

export function LessonPreview({ view }: { view: PreviewView }) {
  return (
    <section className={styles.right} aria-label="Lesson preview">
      <p className={styles.caption}>{view.caption}</p>
      <div
        className={`${styles.frame} ${view.straight ? styles.straight : ""}`}
      >
        <div className={styles.outline}>
          <p className={styles.outlineKind}>Lesson</p>
          <p className={styles.outlineTitle}>
            {view.title ?? <span className={styles.skel} />}
          </p>
          {/* Keyed by state, so the rows come in again when they change. */}
          <ol
            key={view.caption}
            className={styles.rows}
            data-testid={view.isPlan ? "plan-steps" : undefined}
          >
            {view.rows.map((row, i) => (
              <li key={i} style={{ "--i": i } as CSSProperties}>
                {row ?? <span className={styles.skel} />}
              </li>
            ))}
          </ol>
        </div>
        <div className={styles.board}>
          {view.drawing && <SampleBoard />}
          <div className={styles.tutor}>
            <em>{view.card.status}</em>
            <span>
              {view.card.parts.map((p, i) =>
                p.strong ? <b key={i}>{p.text}</b> : p.text,
              )}
            </span>
          </div>
        </div>
        <div className={styles.pdf} aria-hidden>
          {PDF_LINES.map((kind, i) => (
            <span
              key={i}
              className={styles.line}
              data-line={kind || undefined}
              data-lit={
                view.drawing && kind.startsWith("quote") ? "" : undefined
              }
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/** The sample step, drawn on the real board as the clock runs, once. */
function SampleBoard() {
  const t = useDrawClock(END_MS);
  return (
    <div className={styles.drawing}>
      <Whiteboard state={sceneAt(SAMPLE_STEP.objects, TIMED, t)} view={VIEW} />
    </div>
  );
}

/** Milliseconds since mount, up to `endMs`. With reduced motion, `endMs` at once: the final frame. */
function useDrawClock(endMs: number): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let start: number | undefined;
    let frame = requestAnimationFrame(function tick(now) {
      start ??= now;
      const elapsed = still ? endMs : Math.min(now - start, endMs);
      setT(elapsed);
      if (elapsed < endMs) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [endMs]);
  return t;
}
