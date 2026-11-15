// Q&A sketch generation (ARCHITECTURE.md sections 4 and 8): Claude writes a narrated sketch in
// the wire format with structured output for the agent's description, on top of the learner's
// board (or an empty one with `fresh`). It is converted to a Sketch, validate.ts checks its
// narration and cues as a step's and its ids against its own objects plus the board's, and
// lib/pipeline/generate.ts retries a rejection once; a second rejection, a refusal, a cut-off
// or a provider error fails the sketch. Then its narration is voiced like a step's (#105), and
// the audio is saved under runs/<lessonId>/answers/ for the browser to play it on its cues.
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  ANSWERS_DIR,
  SketchRequest,
  type SketchResponse,
} from "@/shared/lesson";
import { BoardState, type Sketch } from "@/shared/scene";
import { config } from "@/lib/config";
import { narrate } from "@/lib/narration/tts";
import { saveAnswer } from "@/lib/runs/store";
import {
  claudeMessages,
  type ClaudeMessages,
  generateWithRetry,
} from "@/lib/pipeline/generate";
import {
  SKETCH_OUTPUT_FORMAT,
  validateWireSketch,
} from "@/lib/pipeline/outputFormat";
import {
  SKETCH_SYSTEM_PROMPT,
  sketchContextPrompt,
  sketchRetryPrompt,
} from "@/lib/pipeline/prompts/sketch";

/** The POST /api/sketch body: shared/lesson.ts's SketchRequest, with the description and board capped. */
export const SketchRequestBody = SketchRequest.extend({
  description: SketchRequest.shape.description.max(
    config.sketch.maxDescriptionChars,
  ),
  board: BoardState.extend({
    objects: BoardState.shape.objects.max(config.maxBoardObjects),
  }),
});
export type SketchRequestBody = z.infer<typeof SketchRequestBody>;

/** The request (pure). */
export function buildSketchRequest(
  req: SketchRequestBody,
): Anthropic.MessageStreamParams {
  return {
    model: config.models.sketch,
    max_tokens: config.sketch.maxTokens,
    system: SKETCH_SYSTEM_PROMPT,
    output_config: {
      effort: config.effort.sketch,
      format: SKETCH_OUTPUT_FORMAT,
    },
    messages: [{ role: "user", content: sketchContextPrompt(req) }],
  };
}

/** Writes a sketch and validates it against the board it draws on. Throws GenerationError. */
export async function generateSketch(
  req: SketchRequestBody,
  messages: ClaudeMessages = claudeMessages(config.sketch.fixture),
): Promise<Sketch> {
  return generateWithRetry(
    {
      label: "sketch",
      request: buildSketchRequest(req),
      validate: (json) =>
        validateWireSketch(json, { board: req.board, fresh: req.fresh }),
      retryPrompt: sketchRetryPrompt,
      timeoutMs: config.sketch.timeoutMs,
    },
    messages,
  );
}

/**
 * A narrated answer (#105): the sketch, its narration voiced with the lesson's narrator as a
 * step's is, and the audio saved in the lesson's run folder. Throws GenerationError (Claude),
 * TtsError or NoAlignmentError (voicing), or a save error.
 */
export async function narratedAnswer(
  req: SketchRequestBody,
  messages?: ClaudeMessages,
): Promise<SketchResponse> {
  const sketch = await generateSketch(req, messages);
  const { audio, cueTimes } = await narrate(sketch.narration);
  const file = await saveAnswer(
    req.lessonId,
    { description: req.description, sketch, cueTimes },
    audio,
  );
  return {
    sketch,
    audioUrl: `/api/runs/${req.lessonId}/${ANSWERS_DIR}/${file}`,
    cueTimes,
  };
}
