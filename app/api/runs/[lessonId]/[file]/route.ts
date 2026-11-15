// GET /api/runs/<lessonId>/<file>: serves step JSON, audio, media and the paper from runs/
// (ARCHITECTURE.md section 5.1). runs/ is outside public/, and `next start` won't serve files
// added after the build. lib/runs/store.ts checks every name and refuses symlinks and folders.
import "server-only";
import type { NextRequest } from "next/server";
import { readRunFile, servableContentType } from "@/lib/runs/store";
import type { ApiError } from "@/shared/lesson";
import { RUNS_ROUTE_ERRORS } from "./errors";

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/runs/[lessonId]/[file]">,
) {
  const { lessonId, file } = await ctx.params;
  const contentType = servableContentType(lessonId, file);
  if (contentType === undefined)
    return Response.json(
      { error: RUNS_ROUTE_ERRORS.badName } satisfies ApiError,
      { status: 400 },
    );

  let result;
  try {
    result = await readRunFile(lessonId, file);
  } catch (err) {
    console.error(`[api/runs] ${lessonId}/${file} read failed`, err);
    return Response.json(
      { error: RUNS_ROUTE_ERRORS.failed } satisfies ApiError,
      { status: 500 },
    );
  }
  if (result.kind === "refused") {
    console.warn(`[api/runs] ${lessonId}/${file} refused: ${result.reason}`);
    return Response.json(
      { error: RUNS_ROUTE_ERRORS.badName } satisfies ApiError,
      { status: 400 },
    );
  }
  if (result.kind === "missing")
    return Response.json(
      { error: RUNS_ROUTE_ERRORS.missing(lessonId, file) } satisfies ApiError,
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
