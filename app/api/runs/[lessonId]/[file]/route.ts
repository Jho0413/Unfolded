// GET /api/runs/<lessonId>/<file>: serves step JSON, audio, media and the paper from runs/
// (ARCHITECTURE.md section 5.1). runs/ is outside public/, and `next start` won't serve files
// added after the build. lib/runs/store.ts checks every name and refuses symlinks and folders.
import "server-only";
import type { NextRequest } from "next/server";
import { serveRunFile } from "./serve";

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/runs/[lessonId]/[file]">,
) {
  const { lessonId, file } = await ctx.params;
  return serveRunFile(lessonId, file);
}
