// What POST /api/lessons/<lessonId>/steps/<n> tells the browser (ARCHITECTURE.md section 7).
// Bodies follow the shared ApiError; the player shows the message in its `failed` state.
import { NO_SUCH_LESSON, STEP_NOT_IN_RUN } from "@/shared/lesson";

export const STEP_ROUTE_ERRORS = {
  /** A bad lessonId, a lesson with no plan, or n not a step in the plan. */
  noSuchStep: NO_SUCH_LESSON,
  /** Replay mode (REPLAY_RUN): the step has no saved file in the run. */
  notInRun: STEP_NOT_IN_RUN,
  /** Any `failed` cause in section 6.2, or a failure outside it; the next request tries again. */
  failed: "Couldn't make this step.",
} as const;
