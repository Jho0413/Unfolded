// Q&A sketch generation (ARCHITECTURE.md sections 4 and 8): Claude writes a sketch in the wire
// format with structured output for the agent's description, on top of the learner's board (or
// an empty one with `fresh`). It is converted to a Sketch, validate.ts checks its ids against
// its own objects plus the board's, and
// lib/pipeline/generate.ts retries a rejection once; a second rejection, a refusal, a cut-off
// or a provider error fails the sketch.
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { SketchRequest } from "@/shared/lesson";
import { BoardState, type Sketch } from "@/shared/scene";
import { config } from "@/lib/config";
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

/** The POST /api/sketch body: shared/lesson.ts's SketchRequest, with the board capped. */
export const SketchRequestBody = SketchRequest.extend({
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
