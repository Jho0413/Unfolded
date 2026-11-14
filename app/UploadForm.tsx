"use client";
// The upload page's form (ROADMAP L1, ARCHITECTURE.md sections 5.1 and 7): pick a PDF, send it
// to POST /api/lessons, then show the plan as a list of step titles with the way into the
// lesson. Failures show the server's plain words, with the form still there to try again.
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { BOARD_BG, INK, MUTED } from "@/player/primitives/style";
import {
  ApiError,
  CreateLessonResponse,
  type LessonPlan,
} from "@/shared/lesson";
import { PDF_FIELD, UPLOAD_ERRORS } from "./upload";

type State =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "planned"; lessonId: string; plan: LessonPlan }
  | { kind: "failed"; message: string };

/** The route's answer as a state. Anything unexpected reads as a failed plan. */
async function upload(file: File): Promise<State> {
  const body = new FormData();
  body.append(PDF_FIELD, file);
  try {
    const res = await fetch("/api/lessons", { method: "POST", body });
    const json: unknown = await res.json();
    if (res.ok) {
      const created = CreateLessonResponse.parse(json);
      return { kind: "planned", ...created };
    }
    return { kind: "failed", message: ApiError.parse(json).error };
  } catch (err) {
    console.error("[upload]", err);
    return { kind: "failed", message: UPLOAD_ERRORS.planFailed };
  }
}

export function UploadForm() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get(PDF_FIELD);
    if (!(file instanceof File) || file.size === 0) {
      setState({ kind: "failed", message: UPLOAD_ERRORS.notPdf });
      return;
    }
    setState({ kind: "uploading" });
    setState(await upload(file));
  }

  if (state.kind === "planned")
    return (
      <section data-testid="plan" style={{ marginTop: 24 }}>
        <h2 style={{ margin: "0 0 12px" }}>{state.plan.title}</h2>
        <ol
          data-testid="plan-steps"
          style={{ paddingLeft: 24, lineHeight: 1.6 }}
        >
          {state.plan.steps.map((step, i) => (
            <li key={i}>{step.title}</li>
          ))}
        </ol>
        <Link
          href={`/lesson/${state.lessonId}`}
          data-testid="start-lesson"
          style={BUTTON}
        >
          Start the lesson
        </Link>
      </section>
    );

  const busy = state.kind === "uploading";
  return (
    <form
      onSubmit={onSubmit}
      data-testid="upload-form"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        marginTop: 24,
      }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        A research paper (PDF)
        <input
          type="file"
          name={PDF_FIELD}
          accept="application/pdf,.pdf"
          disabled={busy}
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        style={{ ...BUTTON, alignSelf: "flex-start" }}
      >
        {busy ? "Reading the paper…" : "Make the lesson"}
      </button>
      {busy && (
        <p style={{ color: MUTED, margin: 0 }}>
          Planning the lesson. This takes up to a minute.
        </p>
      )}
      {state.kind === "failed" && (
        <p role="alert" data-testid="upload-error" style={{ margin: 0 }}>
          {state.message}
        </p>
      )}
    </form>
  );
}

const BUTTON = {
  display: "inline-block",
  padding: "8px 16px",
  font: "inherit",
  fontSize: 16,
  borderRadius: 6,
  border: `1px solid ${INK}`,
  background: INK,
  color: BOARD_BG,
  textDecoration: "none",
  cursor: "pointer",
} as const;
