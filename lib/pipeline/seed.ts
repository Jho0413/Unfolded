// `npm run seed:m2` (ROADMAP G2): a lesson from a hand-made plan instead of Claude's, so steps
// can be generated before (or without) the upload page. The paper is uploaded with the Files
// API and the run folder gets what POST /api/lessons writes: paper.json, then plan.json last.
// Generic: the papers and their plans are data (scripts/seed-m2.lessons.json), never code.
import "server-only";
import { z } from "zod";
import { LessonId, LessonPlanOutput } from "@/shared/lesson";
import { config } from "@/lib/config";
import type { ClaudeFiles } from "@/lib/pipeline/generate";
import { pdfProblem } from "@/lib/pipeline/pdf";
import {
  PAPER_FILE,
  PLAN_FILE,
  type SavedPaper,
  uploadPaper,
  validatePlan,
} from "@/lib/pipeline/plan";
import { writeRunJson } from "@/lib/runs/store";

const MB = 1024 * 1024;

export const SeedLesson = z.object({
  lessonId: LessonId,
  /** Where the script downloads the paper when it isn't given a local copy. */
  pdfUrl: z.url({ protocol: /^https$/ }),
  plan: LessonPlanOutput,
});
export type SeedLesson = z.infer<typeof SeedLesson>;

export const SeedFile = z.object({ lessons: z.array(SeedLesson).min(1) });

/**
 * The seed file's lessons, each plan held to the same rules as Claude's (validatePlan), so a
 * bad file fails before anything is uploaded. Throws with every problem found.
 */
export function parseSeedFile(input: unknown): SeedLesson[] {
  const file = SeedFile.parse(input);
  const problems = file.lessons.flatMap((lesson) => {
    const checked = validatePlan(lesson.plan);
    return checked.ok
      ? []
      : [`${lesson.lessonId}: ${checked.errors.join("; ")}`];
  });
  const ids = file.lessons.map((l) => l.lessonId);
  const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (repeated.length > 0)
    problems.push(`lessonId used twice: ${repeated.join(", ")}`);
  if (problems.length > 0)
    throw new Error(`bad seed file: ${problems.join(" | ")}`);
  return file.lessons;
}

/**
 * Uploads the paper and writes the lesson's run folder: paper.json, then plan.json. Replaces
 * an earlier seed of the same lesson (steps already saved in it are kept). Throws when the
 * bytes aren't a usable PDF (before uploading) or the upload fails (GenerationError).
 */
export async function seedLesson(
  lesson: SeedLesson,
  pdf: Uint8Array,
  files: ClaudeFiles,
): Promise<SavedPaper> {
  const problem = pdfProblem(pdf, {
    maxBytes: config.maxPdfMb * MB,
    maxPages: config.maxPdfPages,
  });
  if (problem !== undefined)
    throw new Error(`${lesson.lessonId}: the paper can't be used (${problem})`);
  const filename = `${lesson.lessonId}.pdf`;
  const paper: SavedPaper = {
    fileId: await uploadPaper(pdf, filename, files),
    filename,
  };
  await writeRunJson(lesson.lessonId, PAPER_FILE, paper);
  // Last, as POST /api/lessons does, so a lesson the page can open is always complete.
  await writeRunJson(lesson.lessonId, PLAN_FILE, lesson.plan);
  return paper;
}
