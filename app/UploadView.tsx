"use client";
// The upload page (ROADMAP L1, ARCHITECTURE.md sections 5.1 and 7): on the left, pick or drop a
// PDF, which goes to POST /api/lessons while a paced stage list runs, then the plan (its fal
// cover if it has one, ROADMAP L4) with the way into the lesson; on the right, a miniature of
// the lesson page (./LessonPreview.tsx). Failures show the server's plain words, with the
// picker still there to try again. The decisions are in ./uploadFlow.ts.
import Link from "next/link";
import { type ChangeEvent, useEffect, useState } from "react";
import { ThemeToggle } from "@/app/lesson/[lessonId]/Toggles";
import lessonStyles from "@/app/lesson/[lessonId]/lesson.module.css";
import { shortcut } from "@/player/controls";
import styles from "./home.module.css";
import { LessonPreview } from "./LessonPreview";
import type { SampleLesson } from "./samples";
import { PDF_FIELD } from "./upload";
import {
  HOME_TEXT,
  IDLE,
  ideasLabel,
  previewView,
  stageStatuses,
  transition,
  UPLOAD_STAGE_MS,
  UPLOAD_STAGES,
  type UploadEvent,
  type UploadState,
} from "./uploadFlow";

/** The key hints under the form: the lesson's own shortcuts (player/controls.ts). */
const KEY_HINTS = [
  shortcut("playPause"),
  shortcut("ask"),
  shortcut("help"),
] as const;

/** Sends the PDF; the route's answer, or that there was none, as an event. */
async function send(file: File): Promise<UploadEvent> {
  const body = new FormData();
  body.append(PDF_FIELD, file);
  try {
    const res = await fetch("/api/lessons", { method: "POST", body });
    return { type: "answered", ok: res.ok, json: await res.json() };
  } catch (err) {
    console.error("[upload]", err);
    return { type: "unreadable" };
  }
}

export function UploadView({ samples }: { samples: SampleLesson[] }) {
  const [state, setState] = useState<UploadState>(IDLE);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [dragging, setDragging] = useState(false);

  async function choose(file: File) {
    const next = transition(state, { type: "choose", file });
    setState(next);
    if (next.kind !== "uploading" || state.kind === "uploading") return;
    setElapsedMs(0);
    // Nothing else changes the state while uploading: a new file is ignored then.
    setState(transition(next, await send(file)));
  }

  // The stage list moves on by time; its last stage waits for the answer.
  const uploading = state.kind === "uploading";
  useEffect(() => {
    if (!uploading) return;
    const timers = UPLOAD_STAGES.slice(1).map((_, i) =>
      setTimeout(
        () => setElapsedMs((i + 1) * UPLOAD_STAGE_MS),
        (i + 1) * UPLOAD_STAGE_MS,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [uploading]);

  // A PDF dropped anywhere on the page. The browser would otherwise open it in place of the page.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) void choose(file);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  });

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    // Cleared, so choosing the same file again (a retry) is a change too.
    event.currentTarget.value = "";
    if (file) void choose(file);
  }

  return (
    <main className={styles.home} data-state={state.kind}>
      <section className={styles.left}>
        <header className={styles.top}>
          <div className={lessonStyles.brand}>
            <i aria-hidden />
            Whiteboard
          </div>
          <ThemeToggle />
        </header>

        <div className={styles.pitch} aria-live="polite">
          {state.kind === "uploading" ? (
            <Uploading fileName={state.fileName} elapsedMs={elapsedMs} />
          ) : state.kind === "planned" ? (
            <Planned
              state={state}
              onAnother={() => setState(transition(state, { type: "another" }))}
            />
          ) : (
            <>
              <p className={styles.kicker}>{HOME_TEXT.kicker}</p>
              <h1 className={styles.headline}>{HOME_TEXT.headline}</h1>
              <p className={styles.lede}>{HOME_TEXT.lede}</p>
              <form
                data-testid="upload-form"
                onSubmit={(e) => e.preventDefault()}
              >
                <label
                  className={`${styles.pick} ${dragging ? styles.over : ""}`}
                >
                  <input
                    type="file"
                    name={PDF_FIELD}
                    accept="application/pdf,.pdf"
                    className={styles.fileInput}
                    onChange={onPick}
                  />
                  <span className={styles.plus} aria-hidden>
                    +
                  </span>
                  <span>
                    <b>{HOME_TEXT.pick}</b>
                    <small>{HOME_TEXT.pickHint}</small>
                  </span>
                </label>
              </form>
              {(state.kind === "failed" || state.notice) && (
                <p
                  role="alert"
                  data-testid="upload-error"
                  className={styles.error}
                >
                  {state.kind === "failed" ? state.message : state.notice}
                </p>
              )}
              {samples.length > 0 && (
                <div className={styles.samples}>
                  <span>{HOME_TEXT.samples}</span>
                  {samples.map((s) => (
                    <Link
                      key={s.lessonId}
                      href={`/lesson/${s.lessonId}`}
                      className={styles.chip}
                      data-testid="sample-lesson"
                    >
                      {s.title}
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <footer className={styles.keys}>
          {KEY_HINTS.map((s) => (
            <span key={s.id}>
              <kbd>{s.label}</kbd> {s.hint}
            </span>
          ))}
        </footer>
      </section>

      <LessonPreview view={previewView(state)} />
    </main>
  );
}

function Uploading({
  fileName,
  elapsedMs,
}: {
  fileName: string;
  elapsedMs: number;
}) {
  const statuses = stageStatuses(elapsedMs);
  return (
    <>
      <p className={styles.kicker}>{HOME_TEXT.making}</p>
      <h1 className={styles.fileName}>{fileName}</h1>
      <ul className={styles.stages} data-testid="upload-stages">
        {UPLOAD_STAGES.map((stage, i) => (
          <li key={stage} data-status={statuses[i]}>
            <span className={styles.dot} aria-hidden />
            {stage}
          </li>
        ))}
      </ul>
      <p className={styles.eta}>{HOME_TEXT.eta}</p>
    </>
  );
}

function Planned({
  state,
  onAnother,
}: {
  state: Extract<UploadState, { kind: "planned" }>;
  onAnother: () => void;
}) {
  const { lessonId, plan } = state;
  return (
    <section data-testid="plan" className={styles.ready}>
      {plan.cover !== undefined && (
        <Cover src={`/api/runs/${lessonId}/${plan.cover}`} />
      )}
      <p className={`${styles.kicker} ${styles.ok}`}>{HOME_TEXT.ready}</p>
      <h2 className={styles.planTitle}>{plan.title}</h2>
      <p className={styles.lede}>{ideasLabel(plan.steps.length)}</p>
      <div className={styles.actions}>
        <Link
          href={`/lesson/${lessonId}`}
          data-testid="start-lesson"
          className={styles.btn}
        >
          {HOME_TEXT.start}
        </Link>
        <button
          type="button"
          className={`${styles.btn} ${styles.ghost}`}
          onClick={onAnother}
        >
          {HOME_TEXT.another}
        </button>
      </div>
    </section>
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
      data-testid="plan-cover"
      className={styles.cover}
      onError={() => setFailed(true)}
    />
  );
}
