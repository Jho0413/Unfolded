// npm run seed:m2's lib side (ROADMAP G2): the committed seed file is valid, a seed writes what
// POST /api/lessons writes (paper.json, then plan.json), and nothing is uploaded for a bad file
// or a bad PDF. The Files API is lib/fakes/claude.ts's fake; runs go to a temp dir.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "@/lib/config";
import { fakeFiles } from "@/lib/fakes/claude";
import { SavedPaper } from "@/lib/pipeline/plan";
import {
  parseSeedFile,
  type SeedLesson,
  seedLesson,
} from "@/lib/pipeline/seed";
import {
  listRunFiles,
  PAPER_FILE,
  PLAN_FILE,
  readRunJson,
} from "@/lib/runs/store";
import { LessonPlan } from "@/shared/lesson";
import { makePdf } from "./pdfs";

const dirs = vi.hoisted(() => ({ runs: "" }));
vi.mock("@/lib/config", async (importOriginal) => {
  const { config } = await importOriginal<typeof import("@/lib/config")>();
  return {
    config: {
      ...config,
      get runsDir() {
        return dirs.runs;
      },
    },
  };
});

beforeEach(async () => {
  dirs.runs = await mkdtemp(path.join(tmpdir(), "seed-runs-"));
});
afterEach(async () => {
  await rm(dirs.runs, { recursive: true, force: true });
});

const UPLOADED: Anthropic.FileMetadata = {
  type: "file",
  id: "file_seed1",
  filename: "x.pdf",
  mime_type: "application/pdf",
  size_bytes: 1,
  created_at: "2026-11-14T00:00:00Z",
};

const lesson = (steps: number = config.plan.minSteps): SeedLesson => ({
  lessonId: "seeded",
  pdfUrl: "https://example.org/paper.pdf",
  plan: {
    title: "A paper",
    coverPrompt: "a cover",
    steps: Array.from({ length: steps }, (_, i) => ({
      title: `Step ${i + 1}`,
      goal: `Goal ${i + 1}.`,
    })),
  },
});

describe("the committed seed file", () => {
  it("scripts/seed-m2.lessons.json: the Attention paper and the second paper, each a valid plan", async () => {
    const lessons = parseSeedFile(
      JSON.parse(await readFile("scripts/seed-m2.lessons.json", "utf8")),
    );
    expect(lessons.map((l) => l.lessonId)).toEqual([
      "m2-attention",
      "m2-newton3p",
    ]);
    for (const l of lessons)
      expect(l.plan.steps.length).toBeGreaterThanOrEqual(3);
  });
});

describe("parseSeedFile", () => {
  it("a plan with too few steps is refused, naming the lesson", () => {
    expect(() => parseSeedFile({ lessons: [lesson(2)] })).toThrow(
      /seeded: too few steps \(2,/,
    );
  });
  it("a lessonId used twice is refused", () => {
    expect(() => parseSeedFile({ lessons: [lesson(), lesson()] })).toThrow(
      /lessonId used twice: seeded/,
    );
  });
  it("a bad lessonId, a non-https URL or no lessons is refused", () => {
    expect(() =>
      parseSeedFile({ lessons: [{ ...lesson(), lessonId: "Bad_Id" }] }),
    ).toThrow();
    expect(() =>
      parseSeedFile({
        lessons: [{ ...lesson(), pdfUrl: "http://example.org/p.pdf" }],
      }),
    ).toThrow();
    expect(() => parseSeedFile({ lessons: [] })).toThrow();
  });
});

describe("seedLesson", () => {
  it("uploads the PDF once and writes paper.json and plan.json", async () => {
    const files = fakeFiles(UPLOADED);
    const pdf = makePdf();
    const paper = await seedLesson(lesson(), pdf, files);
    expect(paper).toEqual({ fileId: UPLOADED.id, filename: "seeded.pdf" });
    expect(files.calls).toHaveLength(1);
    const sent = files.calls[0].params.file as File;
    expect(sent.name).toBe("seeded.pdf");
    expect(new Uint8Array(await sent.arrayBuffer())).toEqual(pdf);
    await expect(
      readRunJson("seeded", PAPER_FILE, SavedPaper),
    ).resolves.toEqual(paper);
    await expect(readRunJson("seeded", PLAN_FILE, LessonPlan)).resolves.toEqual(
      lesson().plan,
    );
  });

  it("bytes that aren't a usable PDF are refused before uploading, and nothing is written", async () => {
    const files = fakeFiles(UPLOADED);
    for (const pdf of [
      new TextEncoder().encode("not a pdf"),
      makePdf({ encrypted: true }),
    ])
      await expect(seedLesson(lesson(), pdf, files)).rejects.toThrow(
        /seeded: the paper can't be used/,
      );
    expect(files.calls).toHaveLength(0);
    expect(await listRunFiles("seeded")).toEqual([]);
  });

  it("a failed upload writes nothing", async () => {
    const files = fakeFiles(new Error("network down"));
    await expect(seedLesson(lesson(), makePdf(), files)).rejects.toThrow(
      "network down",
    );
    expect(await listRunFiles("seeded")).toEqual([]);
  });
});
