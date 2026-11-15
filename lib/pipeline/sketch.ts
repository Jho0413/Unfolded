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
import { narrate, type Narrated } from "@/lib/narration/tts";
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
 *
 * The narration is the wire format's first field, so it is voiced as soon as it has streamed,
 * while Claude still writes the objects and actions (a few seconds, longer than TTS): the
 * learner is waiting in silence. An attempt that is then rejected wastes its voicing; a retry
 * that keeps the same narration reuses it, unless that voicing failed.
 */
export async function narratedAnswer(
  req: SketchRequestBody,
  messages: ClaudeMessages = claudeMessages(config.sketch.fixture),
): Promise<SketchResponse> {
  const voicings = new Map<string, Promise<Narrated>>();
  let voiced = 0;
  const voice = (narration: string): Promise<Narrated> => {
    let voicing = voicings.get(narration);
    if (voicing === undefined) {
      const started = narrate(narration);
      voicing = started;
      voiced++;
      // A voicing whose narration isn't used is dropped: its failure isn't the answer's. A
      // failed one is forgotten, so a retry that keeps the narration voices it again.
      started.catch(() => {
        if (voicings.get(narration) === started) voicings.delete(narration);
      });
      voicings.set(narration, started);
    }
    return voicing;
  };

  const t0 = performance.now();
  const attempts: string[] = [];
  const sketch = await generateSketch(
    req,
    watchedMessages(messages, attempts, voice),
  );
  const t1 = performance.now();
  const { audio, cueTimes } = await voice(sketch.narration);
  const t2 = performance.now();
  const file = await saveAnswer(
    req.lessonId,
    { description: req.description, sketch, cueTimes },
    audio,
  );
  const t3 = performance.now();
  // A debug line for the narrated answer's latency (#105's target: under 12 s end to end).
  console.info(
    `[pipeline] sketch timings: claude ${ms(t1 - t0)} (${attempts.join("; ")}), then voice ${ms(t2 - t1)}, save ${ms(t3 - t2)}, total ${ms(t3 - t0)}; ${voiced} voiced, ${sketch.narration.length} narration chars`,
  );
  return {
    sketch,
    audioUrl: `/api/runs/${req.lessonId}/${ANSWERS_DIR}/${file}`,
    cueTimes,
  };
}

const ms = (n: number) => `${Math.round(n)} ms`;

/**
 * `messages`, voicing each attempt's narration once it has streamed (`onNarration`) and noting
 * each attempt's time and output tokens in `log`.
 */
function watchedMessages(
  messages: ClaudeMessages,
  log: string[],
  onNarration: (narration: string) => unknown,
): ClaudeMessages {
  return {
    stream(body, options) {
      const start = performance.now();
      const stream = messages.stream(body, options);
      let heard = false;
      stream.on?.("text", (_delta, snapshot) => {
        if (heard) return;
        const narration = streamedNarration(snapshot);
        if (narration === undefined) return;
        heard = true;
        onNarration(narration);
      });
      return {
        async finalMessage() {
          const message = await stream.finalMessage();
          log.push(
            `${ms(performance.now() - start)}, ${message.usage.output_tokens} tokens`,
          );
          return message;
        },
      };
    },
  };
}

/** `{ "narration": "<a whole JSON string>"` at the start of the text, up to its closing quote. */
const NARRATION_PREFIX_RE = /^\s*\{\s*"narration"\s*:\s*("(?:[^"\\]|\\.)*")/;

/**
 * The narration of a wire sketch still streaming, once its string has closed (pure): the
 * wire format's first field (outputFormat.ts WireSketch). Undefined until then, or when the
 * text doesn't start with it.
 */
export function streamedNarration(text: string): string | undefined {
  const literal = NARRATION_PREFIX_RE.exec(text)?.[1];
  if (literal === undefined) return undefined;
  try {
    const narration: unknown = JSON.parse(literal);
    return typeof narration === "string" ? narration : undefined;
  } catch {
    return undefined;
  }
}
