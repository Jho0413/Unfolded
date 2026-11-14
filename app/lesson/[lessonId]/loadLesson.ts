// Reads a lesson's plan for the lesson page (ARCHITECTURE.md sections 5.1 and 5.5). The steps
// themselves reach the browser through the step route (./stepRoute.ts).
import "server-only";
import { PLAN_FILE, readRunJson } from "@/lib/runs/store";
import { LESSON_ID_RE, LessonPlan } from "@/shared/lesson";

export type SavedLesson =
  | { kind: "ok"; lessonId: string; plan: LessonPlan }
  /** A bad lessonId, no plan.json, or a plan that can't be read (logged). */
  | { kind: "missing" };

export async function loadLesson(lessonId: string): Promise<SavedLesson> {
  // Any URL can be typed, so a bad id isn't logged.
  if (!LESSON_ID_RE.test(lessonId)) return { kind: "missing" };
  try {
    const plan = await readRunJson(lessonId, PLAN_FILE, LessonPlan);
    if (plan === undefined) return { kind: "missing" };
    return { kind: "ok", lessonId, plan };
  } catch (err) {
    console.error(`[lesson] ${lessonId}: couldn't read the plan`, err);
    return { kind: "missing" };
  }
}
