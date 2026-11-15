// POST /api/lessons/<lessonId>/signals: records a learner signal, a question, a simplify request
// or "version k of step n started" (ARCHITECTURE.md section 5.4), in runs/<lessonId>/signals.json,
// and answers the signals version after it. A question or simplify request makes any step that
// hasn't started and was made with an older version stale: the step route regenerates it on its
// next request (lib/pipeline/lessonStep.ts).
import "server-only";
import { z } from "zod";
import { appendSignal, PLAN_FILE, readRunJson } from "@/lib/runs/store";
import {
  LESSON_ID_RE,
  LessonPlan,
  Signal,
  type ApiError,
  type SignalResponse,
} from "@/shared/lesson";
import { SIGNAL_ROUTE_ERRORS } from "./errors";

const TAG = "[api/lessons/signals]";

function failed(error: string, status: number): Response {
  return Response.json({ error } satisfies ApiError, { status });
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/lessons/[lessonId]/signals">,
): Promise<Response> {
  const { lessonId } = await ctx.params;
  // Any URL can be typed, so a bad name isn't logged.
  if (!LESSON_ID_RE.test(lessonId))
    return failed(SIGNAL_ROUTE_ERRORS.noSuchLesson, 400);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    console.warn(TAG, lessonId, "bad request: the body is not JSON");
    return failed(SIGNAL_ROUTE_ERRORS.badSignal, 400);
  }
  const signal = Signal.safeParse(json);
  if (!signal.success) {
    console.warn(TAG, lessonId, "bad request:", z.prettifyError(signal.error));
    return failed(SIGNAL_ROUTE_ERRORS.badSignal, 400);
  }

  try {
    if ((await readRunJson(lessonId, PLAN_FILE, LessonPlan)) === undefined)
      return failed(SIGNAL_ROUTE_ERRORS.noSuchLesson, 404);
    const version = await appendSignal(lessonId, signal.data);
    return Response.json({ version } satisfies SignalResponse);
  } catch (err) {
    console.error(`${TAG} ${lessonId}: failed to record a signal`, err);
    return failed(SIGNAL_ROUTE_ERRORS.failed, 500);
  }
}
