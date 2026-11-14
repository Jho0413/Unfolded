// POST /api/sketch: a Q&A drawing for the agent's `draw_scene` (ARCHITECTURE.md sections 7
// and 8). The body is { description, fresh, board }; the answer is { sketch }, validated
// against the board it draws on. Any failure gives the learner "Couldn't draw that." and the
// developer the reason in the server log.
import "server-only";
import { z } from "zod";
import { GenerationError } from "@/lib/pipeline/generate";
import { generateSketch, SketchRequestBody } from "@/lib/pipeline/sketch";
import {
  SKETCH_FAILED,
  type ApiError,
  type SketchResponse,
} from "@/shared/lesson";

const TAG = "[api/sketch]";

function failed(status: number): Response {
  return Response.json({ error: SKETCH_FAILED } satisfies ApiError, {
    status,
  });
}

export async function POST(request: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    console.warn(TAG, "bad request: the body is not JSON");
    return failed(400);
  }
  const body = SketchRequestBody.safeParse(json);
  if (!body.success) {
    console.warn(TAG, "bad request:", z.prettifyError(body.error));
    return failed(400);
  }

  try {
    const sketch = await generateSketch(body.data);
    return Response.json({ sketch } satisfies SketchResponse);
  } catch (err) {
    // A GenerationError is Claude failing (502); anything else is a bug or a misconfiguration.
    console.error(TAG, err instanceof GenerationError ? err.message : err);
    return failed(err instanceof GenerationError ? 502 : 500);
  }
}
