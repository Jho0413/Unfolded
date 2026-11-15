// GET /api/runs/<lessonId>/answers/<file>: a drawn answer's audio (#105, ARCHITECTURE.md
// section 8), saved by POST /api/sketch under runs/<lessonId>/answers/. Same checks and
// answers as the run files' route.
import "server-only";
import type { NextRequest } from "next/server";
import { ANSWERS_DIR } from "@/shared/lesson";
import { serveRunFile } from "../../[file]/serve";

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/runs/[lessonId]/answers/[file]">,
) {
  const { lessonId, file } = await ctx.params;
  return serveRunFile(lessonId, file, ANSWERS_DIR);
}
