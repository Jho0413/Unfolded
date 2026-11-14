// POST /api/lessons/<lessonId>/steps/<n>: step n (0-based) as a StepResponse, generated, narrated
// and saved to runs/ if it isn't saved yet (ARCHITECTURE.md sections 5.1, 6.2 and 7). A request
// while the step is generating waits for that generation; after a failure, a new request tries
// again. In replay mode (REPLAY_RUN) a step comes only from the saved run: one that isn't
// there is a 404 "This step isn't in the saved run.". lib/pipeline/lessonStep.ts does the work
// and logs failures.
import "server-only";
import type { NextRequest } from "next/server";
import { requestStep, parseStepNumber } from "@/lib/pipeline/lessonStep";
import {
  LESSON_ID_RE,
  type ApiError,
  type StepResponse,
} from "@/shared/lesson";
import { STEP_ROUTE_ERRORS } from "./errors";

function failed(error: string, status: number): Response {
  return Response.json({ error } satisfies ApiError, { status });
}

export async function POST(
  _req: NextRequest,
  ctx: RouteContext<"/api/lessons/[lessonId]/steps/[n]">,
): Promise<Response> {
  const { lessonId, n: rawN } = await ctx.params;
  const n = parseStepNumber(rawN);
  // Any URL can be typed, so a bad name isn't logged.
  if (!LESSON_ID_RE.test(lessonId) || n === undefined)
    return failed(STEP_ROUTE_ERRORS.noSuchStep, 400);

  const outcome = await requestStep(lessonId, n);
  switch (outcome.kind) {
    case "ok":
      return Response.json(outcome.response satisfies StepResponse);
    case "noSuchLesson":
      return failed(STEP_ROUTE_ERRORS.noSuchStep, 404);
    case "noSuchStep":
      return failed(STEP_ROUTE_ERRORS.noSuchStep, 400);
    case "notInRun":
      return failed(STEP_ROUTE_ERRORS.notInRun, 404);
    case "failed":
      return failed(STEP_ROUTE_ERRORS.failed, outcome.status);
  }
}
