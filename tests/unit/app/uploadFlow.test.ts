// app/uploadFlow.ts: one test per row of the upload page's table (ARCHITECTURE.md section 5.1),
// then the paced stages and the lesson preview. The browser side of each row is in
// tests/e2e/upload.spec.ts; the "server | sample run missing" row is in upload-page.test.tsx.
import { describe, expect, it } from "vitest";
import { UPLOAD_ERRORS } from "@/app/upload";
import {
  type ChosenFile,
  IDLE,
  ideasLabel,
  isPdf,
  previewView,
  stageStatuses,
  transition,
  UPLOAD_STAGE_MS,
  UPLOAD_STAGES,
  type UploadState,
} from "@/app/uploadFlow";
import { SAMPLE_LESSON } from "@/app/previewScene";
import { CARD_STATUS } from "@/player/cardView";
import type { LessonPlan } from "@/shared/lesson";

const PDF: ChosenFile = {
  name: "chapter.pdf",
  type: "application/pdf",
  size: 1000,
};
const NOTES: ChosenFile = { name: "notes.txt", type: "text/plain", size: 10 };
const PLAN: LessonPlan = {
  title: "How Bridges Stand Up",
  steps: [
    { title: "Loads", goal: "What a bridge carries." },
    { title: "Arches", goal: "How an arch turns load into compression." },
  ],
  coverPrompt: "A stone arch.",
  cover: "cover.jpg",
};
const uploading: UploadState = { kind: "uploading", fileName: "chapter.pdf" };
const planned: UploadState = {
  kind: "planned",
  lessonId: "how-bridges-1a2b3c4d",
  plan: PLAN,
};
const failed: UploadState = {
  kind: "failed",
  message: UPLOAD_ERRORS.planFailed,
};

describe("the upload page's table", () => {
  it("idle | choose a PDF: uploading", () => {
    expect(transition(IDLE, { type: "choose", file: PDF })).toEqual(uploading);
  });

  it("idle | drop a PDF anywhere: uploading (a drop is the same choose event)", () => {
    const dropped = { name: "Report.PDF", type: "", size: 5 };
    expect(transition(IDLE, { type: "choose", file: dropped })).toEqual({
      kind: "uploading",
      fileName: "Report.PDF",
    });
  });

  it("idle | drop a non-PDF: stays idle with Please choose a PDF.", () => {
    expect(transition(IDLE, { type: "choose", file: NOTES })).toEqual({
      kind: "idle",
      notice: UPLOAD_ERRORS.notPdf,
    });
  });

  it("uploading | 200 plan: planned, with the lesson id and plan", () => {
    const json = { lessonId: "how-bridges-1a2b3c4d", plan: PLAN };
    expect(transition(uploading, { type: "answered", ok: true, json })).toEqual(
      planned,
    );
  });

  it("uploading | 200 with a body that isn't a plan: failed with the planFailed message", () => {
    expect(
      transition(uploading, { type: "answered", ok: true, json: { plan: 1 } }),
    ).toEqual(failed);
  });

  it("uploading | 4xx/5xx with an error: failed with the server's message", () => {
    for (const error of [UPLOAD_ERRORS.tooLargeOrLocked, UPLOAD_ERRORS.notPdf])
      expect(
        transition(uploading, {
          type: "answered",
          ok: false,
          json: { error },
        }),
      ).toEqual({ kind: "failed", message: error });
  });

  it("uploading | 4xx/5xx without an error body: failed with the planFailed message", () => {
    expect(
      transition(uploading, { type: "answered", ok: false, json: "oops" }),
    ).toEqual(failed);
  });

  it("uploading | network error or bad JSON: failed with the planFailed message", () => {
    expect(transition(uploading, { type: "unreadable" })).toEqual(failed);
  });

  it("planned | Another PDF: idle", () => {
    expect(transition(planned, { type: "another" })).toEqual(IDLE);
  });

  it("failed | choose again: uploading", () => {
    expect(transition(failed, { type: "choose", file: PDF })).toEqual(
      uploading,
    );
  });

  it("failed | drop a non-PDF: idle with Please choose a PDF.", () => {
    expect(transition(failed, { type: "choose", file: NOTES })).toEqual({
      kind: "idle",
      notice: UPLOAD_ERRORS.notPdf,
    });
  });

  it("idle with a notice | choose a PDF: uploading, the notice gone", () => {
    const noticed = transition(IDLE, { type: "choose", file: NOTES });
    expect(transition(noticed, { type: "choose", file: PDF })).toEqual(
      uploading,
    );
  });

  it("can't happen: a file while uploading or planned is ignored", () => {
    for (const state of [uploading, planned])
      expect(transition(state, { type: "choose", file: PDF })).toBe(state);
  });

  it("can't happen: an answer when not uploading is ignored", () => {
    for (const state of [IDLE, planned, failed]) {
      expect(transition(state, { type: "unreadable" })).toBe(state);
      expect(
        transition(state, { type: "answered", ok: true, json: { error: "x" } }),
      ).toBe(state);
    }
  });

  it("can't happen: Another PDF outside planned is ignored", () => {
    for (const state of [IDLE, uploading, failed])
      expect(transition(state, { type: "another" })).toBe(state);
  });
});

describe("isPdf", () => {
  it.each([
    [{ name: "a.pdf", type: "application/pdf", size: 1 }, true],
    [{ name: "A.PDF", type: "", size: 1 }, true],
    [{ name: "scan", type: "application/pdf", size: 1 }, true],
    [{ name: "a.pdf", type: "application/pdf", size: 0 }, false],
    [{ name: "a.docx", type: "application/msword", size: 9 }, false],
    [{ name: "a.pdf.txt", type: "text/plain", size: 9 }, false],
    [{ name: "", type: "", size: 9 }, false],
  ])("%o -> %s", (file, expected) => {
    expect(isPdf(file)).toBe(expected);
  });
});

describe("stageStatuses: paced by time, the last waits for the answer", () => {
  it("at the start: the first stage in progress", () => {
    expect(stageStatuses(0)).toEqual(["on", "waiting", "waiting", "waiting"]);
  });

  it("one stage per UPLOAD_STAGE_MS", () => {
    expect(stageStatuses(UPLOAD_STAGE_MS * 2 + 1)).toEqual([
      "done",
      "done",
      "on",
      "waiting",
    ]);
  });

  it("long after the last stage's time: still in progress, never all done", () => {
    for (const ms of [UPLOAD_STAGE_MS * UPLOAD_STAGES.length, 10 * 60_000])
      expect(stageStatuses(ms)).toEqual(["done", "done", "done", "on"]);
  });

  it("a negative clock reads as the start", () => {
    expect(stageStatuses(-5)[0]).toBe("on");
  });
});

describe("previewView", () => {
  it("idle and failed: the sample lesson drawing itself, tilted", () => {
    for (const state of [IDLE, failed]) {
      const view = previewView(state);
      expect(view).toMatchObject({
        title: SAMPLE_LESSON.title,
        rows: SAMPLE_LESSON.steps,
        isPlan: false,
        drawing: true,
        straight: false,
      });
      expect(view.card.status).toBe(CARD_STATUS.explaining);
    }
  });

  it("uploading: a skeleton outline, an empty board", () => {
    const view = previewView(uploading);
    expect(view.title).toBeNull();
    expect(view.rows.length).toBeGreaterThan(0);
    expect(view.rows.every((r) => r === null)).toBe(true);
    expect(view.drawing).toBe(false);
    expect(view.card.status).toBe(CARD_STATUS.preparing);
  });

  it("planned: the plan's title and ideas, the lesson's intro, facing the learner", () => {
    const view = previewView(planned);
    expect(view).toMatchObject({
      title: PLAN.title,
      rows: ["Loads", "Arches"],
      isPlan: true,
      drawing: false,
      straight: true,
    });
    expect(view.card.status).toBe(CARD_STATUS.ready);
    expect(view.card.parts.map((p) => p.text).join("")).toContain(
      `2 ideas from ${PLAN.title}.`,
    );
  });
});

it("ideasLabel", () => {
  expect(ideasLabel(1)).toBe("1 idea");
  expect(ideasLabel(11)).toBe("11 ideas");
});
