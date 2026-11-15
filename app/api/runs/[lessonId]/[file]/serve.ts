// Serves one run file (ARCHITECTURE.md section 5.1), for GET /api/runs/<lessonId>/<file> and
// GET /api/runs/<lessonId>/answers/<file> (#105). lib/runs/store.ts checks every name and
// refuses symlinks and folders.
import "server-only";
import {
  readRunFile,
  type RunSubfolder,
  servableContentType,
} from "@/lib/runs/store";
import type { ApiError } from "@/shared/lesson";
import { RUNS_ROUTE_ERRORS } from "./errors";

export async function serveRunFile(
  lessonId: string,
  file: string,
  sub?: RunSubfolder,
): Promise<Response> {
  const name = sub === undefined ? file : `${sub}/${file}`;
  const contentType = servableContentType(lessonId, file);
  if (contentType === undefined)
    return Response.json(
      { error: RUNS_ROUTE_ERRORS.badName } satisfies ApiError,
      { status: 400 },
    );

  let result;
  try {
    result = await readRunFile(lessonId, file, sub);
  } catch (err) {
    console.error(`[api/runs] ${lessonId}/${name} read failed`, err);
    return Response.json(
      { error: RUNS_ROUTE_ERRORS.failed } satisfies ApiError,
      { status: 500 },
    );
  }
  if (result.kind === "refused") {
    console.warn(`[api/runs] ${lessonId}/${name} refused: ${result.reason}`);
    return Response.json(
      { error: RUNS_ROUTE_ERRORS.badName } satisfies ApiError,
      { status: 400 },
    );
  }
  if (result.kind === "missing")
    return Response.json(
      { error: RUNS_ROUTE_ERRORS.missing(lessonId, name) } satisfies ApiError,
      { status: 404 },
    );

  return new Response(new Uint8Array(result.data), {
    headers: {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      // Not every run file is immutable (signals.json grows), so nothing is cached.
      "Cache-Control": "no-store",
    },
  });
}
