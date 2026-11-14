// GET /api/runs/<lessonId>/<file>: serves step JSON, audio and media from runs/ (ARCHITECTURE.md
// section 5.1). runs/ is outside public/, and `next start` won't serve files added after the
// build. lib/runs/store.ts checks every name and refuses symlinks and folders.
import "server-only";
import type { NextRequest } from "next/server";
import { contentTypeFor, isServableName, readRunFile } from "@/lib/runs/store";
import { RUNS_ROUTE_ERRORS } from "./errors";

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/runs/[lessonId]/[file]">,
) {
  const { lessonId, file } = await ctx.params;
  if (!isServableName(lessonId, file))
    return Response.json({ error: RUNS_ROUTE_ERRORS.badName }, { status: 400 });

  const result = await readRunFile(lessonId, file);
  if (result.kind === "refused") {
    console.warn(`[api/runs] ${lessonId}/${file} refused: ${result.reason}`);
    return Response.json({ error: RUNS_ROUTE_ERRORS.badName }, { status: 400 });
  }
  if (result.kind === "missing")
    return Response.json(
      { error: RUNS_ROUTE_ERRORS.missing(lessonId, file) },
      { status: 404 },
    );

  return new Response(new Uint8Array(result.data), {
    headers: {
      "Content-Type": contentTypeFor(file)!,
      "X-Content-Type-Options": "nosniff",
      // Not every run file is immutable (signals.json grows), so nothing is cached.
      "Cache-Control": "no-store",
    },
  });
}
