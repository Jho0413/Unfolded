// The upload page's states and words (ARCHITECTURE.md section 5.1, "The upload page"): what a
// chosen or dropped file, the route's answer and "Another PDF" do, the paced stage list, and
// what the lesson preview beside the form shows. Pure: app/UploadView.tsx does the I/O.
import type { CardPart } from "@/player/cardView";
import { CARD_STATUS, introParts } from "@/player/cardView";
import {
  ApiError,
  CreateLessonResponse,
  type LessonPlan,
} from "@/shared/lesson";
import { SAMPLE_LESSON, SAMPLE_LINE } from "./previewScene";
import { UPLOAD_ERRORS } from "./upload";

export type UploadState =
  /** `notice`: a chosen or dropped file that isn't a PDF, said without asking the server. */
  | { kind: "idle"; notice?: string }
  | { kind: "uploading"; fileName: string }
  | { kind: "planned"; lessonId: string; plan: LessonPlan }
  | { kind: "failed"; message: string };

export type UploadEvent =
  /** From the picker or a drop anywhere on the page. */
  | { type: "choose"; file: ChosenFile }
  /** The route answered: its status was ok or not, with its body parsed as JSON. */
  | { type: "answered"; ok: boolean; json: unknown }
  /** No answer: the request failed, or the body wasn't JSON. */
  | { type: "unreadable" }
  | { type: "another" };

export type ChosenFile = { name: string; type: string; size: number };

export const IDLE: UploadState = { kind: "idle" };

/** What the page's words are, in one place (tests read them too). */
export const HOME_TEXT = {
  kicker: "An AI tutor for anything long to read",
  headline: "Give it a PDF. It teaches you on a whiteboard.",
  lede: "Papers, articles, reports, book chapters, lecture notes. It reads the PDF, plans a lesson of a few clear ideas, then explains each one out loud while drawing, with the PDF open beside it. Stop it and ask anything.",
  pick: "Choose a PDF",
  pickHint: "or drop it anywhere on this page",
  samples: "No PDF handy? Open a ready-made lesson:",
  making: "Making your lesson",
  eta: "About 20 seconds.",
  ready: "Ready",
  start: "Start the lesson →",
  another: "Another PDF",
} as const;

/**
 * The upload's stages. POST /api/lessons is one request, so they're paced by time
 * (UPLOAD_STAGE_MS each), and the last one stays in progress until the answer arrives.
 */
export const UPLOAD_STAGES = [
  "Reading the PDF",
  "Finding the ideas worth teaching",
  "Planning the lesson",
  "Painting a cover",
] as const;

/** About 20 seconds for a real plan, over the four stages. */
export const UPLOAD_STAGE_MS = 5000;

export type StageStatus = "done" | "on" | "waiting";

/** Each stage's status `elapsedMs` into the upload: never all done, the answer ends it. */
export function stageStatuses(elapsedMs: number): StageStatus[] {
  const on = Math.min(
    Math.max(Math.floor(elapsedMs / UPLOAD_STAGE_MS), 0),
    UPLOAD_STAGES.length - 1,
  );
  return UPLOAD_STAGES.map((_, i) =>
    i < on ? "done" : i === on ? "on" : "waiting",
  );
}

/** A PDF by its type or name, not empty. The route checks its bytes. */
export function isPdf(file: ChosenFile): boolean {
  return (
    file.size > 0 &&
    (file.type === "application/pdf" || /\.pdf$/i.test(file.name))
  );
}

/** The page's state machine (the table in ARCHITECTURE.md section 5.1). */
export function transition(
  state: UploadState,
  event: UploadEvent,
): UploadState {
  switch (event.type) {
    case "choose":
      // A file arriving while one uploads, or once the plan is shown, is ignored.
      if (state.kind !== "idle" && state.kind !== "failed") return state;
      if (!isPdf(event.file))
        return { kind: "idle", notice: UPLOAD_ERRORS.notPdf };
      return { kind: "uploading", fileName: event.file.name };
    case "answered":
      if (state.kind !== "uploading") return state;
      return answerState(event.ok, event.json);
    case "unreadable":
      if (state.kind !== "uploading") return state;
      return { kind: "failed", message: UPLOAD_ERRORS.planFailed };
    case "another":
      return state.kind === "planned" ? IDLE : state;
  }
}

/** The route's answer as a state. Anything unexpected reads as a failed plan. */
function answerState(ok: boolean, json: unknown): UploadState {
  if (ok) {
    const created = CreateLessonResponse.safeParse(json);
    return created.success
      ? { kind: "planned", ...created.data }
      : { kind: "failed", message: UPLOAD_ERRORS.planFailed };
  }
  const error = ApiError.safeParse(json);
  return {
    kind: "failed",
    message: error.success ? error.data.error : UPLOAD_ERRORS.planFailed,
  };
}

/** "11 ideas" */
export function ideasLabel(count: number): string {
  return `${count} ${count === 1 ? "idea" : "ideas"}`;
}

/** What the miniature lesson page beside the form shows. */
export interface PreviewView {
  /** The small label above the frame. */
  caption: string;
  /** The outline's title; null while planning (a skeleton). */
  title: string | null;
  /** The outline's rows; null rows are skeletons. */
  rows: readonly (string | null)[];
  /** The rows are the plan's steps. */
  isPlan: boolean;
  /** The board draws the sample step; otherwise it's empty, as before a step plays. */
  drawing: boolean;
  card: { status: string; parts: CardPart[] };
  /** The frame faces the learner (planned); otherwise it's tilted. */
  straight: boolean;
}

/** Skeleton rows while the plan is made. */
const PLANNING_ROWS = 8;

export function previewView(state: UploadState): PreviewView {
  switch (state.kind) {
    case "idle":
    case "failed":
      return {
        caption: "What a lesson looks like",
        title: SAMPLE_LESSON.title,
        rows: SAMPLE_LESSON.steps,
        isPlan: false,
        drawing: true,
        card: {
          status: CARD_STATUS.explaining,
          parts: [{ text: SAMPLE_LINE }],
        },
        straight: false,
      };
    case "uploading":
      return {
        caption: "Planning…",
        title: null,
        rows: Array<null>(PLANNING_ROWS).fill(null),
        isPlan: false,
        drawing: false,
        card: {
          status: CARD_STATUS.preparing,
          parts: [{ text: "The outline fills in once the lesson is planned." }],
        },
        straight: false,
      };
    case "planned":
      return {
        caption: "Your lesson",
        title: state.plan.title,
        rows: state.plan.steps.map((s) => s.title),
        isPlan: true,
        drawing: false,
        card: {
          status: CARD_STATUS.ready,
          parts: introParts(state.plan.steps.length, state.plan.title),
        },
        straight: true,
      };
  }
}
