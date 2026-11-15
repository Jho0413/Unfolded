// POST /api/sketch: a Q&A drawing for the agent's `draw_scene` (ARCHITECTURE.md sections 7
// and 8). The body is { description, fresh, board, lessonId }; the answer is a narrated
// sketch (#105), { sketch, audioUrl, cueTimes }, validated against the board it draws on, its
// narration voiced and saved under runs/<lessonId>/answers/. Any failure gives the learner
// "Couldn't draw that." and the developer the reason in the server log.
import "server-only";
import { z } from "zod";
import { NoAlignmentError } from "@/lib/narration/cues";
import { TtsError } from "@/lib/narration/tts";
import { GenerationError } from "@/lib/pipeline/generate";
import { narratedAnswer, SketchRequestBody } from "@/lib/pipeline/sketch";
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
    const answer = await narratedAnswer(body.data);
    return Response.json(answer satisfies SketchResponse);
  } catch (err) {
    // Claude or the voice failing is a 502; anything else is a bug or a misconfiguration.
    const provider = isProviderFailure(err);
    console.error(TAG, err instanceof GenerationError ? err.message : err);
    return failed(provider ? 502 : 500);
  }
}

/** Claude (GenerationError) or the voice (TtsError, NoAlignmentError) failed: not our bug. */
function isProviderFailure(err: unknown): boolean {
  return (
    err instanceof GenerationError ||
    err instanceof TtsError ||
    err instanceof NoAlignmentError
  );
}
