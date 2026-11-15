// What POST /api/lessons/<lessonId>/signals tells the browser (ARCHITECTURE.md sections 5.4 and
// 7). Bodies follow the shared ApiError. The player posts signals in the background, so these
// reach the console, not the learner.
import { NO_SUCH_LESSON } from "@/shared/lesson";

export const SIGNAL_ROUTE_ERRORS = {
  /** A bad lessonId (400), or a lesson with no plan (404). */
  noSuchLesson: NO_SUCH_LESSON,
  /** The body isn't JSON, isn't a Signal, or its text is over `config.maxSignalChars`. */
  badSignal: "That isn't a learner signal.",
  /** signals.json isn't a SignalsFile, or the write failed (logged). */
  failed: "Couldn't record that signal.",
} as const;
