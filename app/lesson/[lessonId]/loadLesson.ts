// Reads a saved lesson for the lesson page (ARCHITECTURE.md sections 5.1 and 5.5): its plan
// and, for each step of the plan, the saved version to play. The step files themselves reach
// the browser through GET /api/runs/<lessonId>/<file>; the browser can't list a run folder,
// so the page tells it which versions exist.
import "server-only";
import { listRunFiles, readRunJson, stepVersions } from "@/lib/runs/store";
import { LESSON_ID_RE, LessonPlan } from "@/shared/lesson";

export type SavedLesson =
  | {
      kind: "ok";
      lessonId: string;
      plan: LessonPlan;
      /** Per plan step, the version to play (the latest saved), or null when none is saved. */
      versions: (number | null)[];
    }
  /** A bad lessonId, no plan.json, or a run folder that can't be read (logged). */
  | { kind: "missing" };

export async function loadLesson(lessonId: string): Promise<SavedLesson> {
  // Any URL can be typed, so a bad id isn't logged.
  if (!LESSON_ID_RE.test(lessonId)) return { kind: "missing" };
  try {
    const plan = await readRunJson(lessonId, "plan.json", LessonPlan);
    if (plan === undefined) return { kind: "missing" };
    const files = await listRunFiles(lessonId);
    const versions = plan.steps.map(
      (_, n) => stepVersions(files, n).at(-1) ?? null,
    );
    return { kind: "ok", lessonId, plan, versions };
  } catch (err) {
    console.error(`[lesson] ${lessonId}: couldn't read the saved run`, err);
    return { kind: "missing" };
  }
}
