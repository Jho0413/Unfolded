// What POST /api/lessons/<lessonId>/steps/<n> tells the browser (ARCHITECTURE.md section 7).
// Bodies follow the shared ApiError; the player shows the message in its `failed` state.
import { NO_SUCH_LESSON } from "@/shared/lesson";

export const STEP_ROUTE_ERRORS = {
  /** A bad lessonId, a lesson with no plan, or n not a step in the plan. */
  noSuchStep: NO_SUCH_LESSON,
  /** Any `failed` cause in section 6.2, or a failure outside it; the next request tries again. */
  failed: "Couldn't make this step.",
} as const;
