// Step generation (ARCHITECTURE.md sections 4, 5.1 and 6.2): Claude writes a Step with
// structured output, validate.ts checks it, and lib/pipeline/generate.ts retries a rejection
// once; a second rejection, a refusal, a cut-off or a provider error fails the step.
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { LessonPlanOutput, Signal } from "@/shared/lesson";
import type { Step } from "@/shared/scene";
import { validateStep } from "@/shared/validate";
import { config } from "@/lib/config";
import {
  claudeMessages,
  type ClaudeMessages,
  generateWithRetry,
} from "@/lib/pipeline/generate";
import { STEP_OUTPUT_FORMAT } from "@/lib/pipeline/outputFormat";
import {
  retryPrompt,
  STEP_SYSTEM_PROMPT,
  stepContextPrompt,
} from "@/lib/pipeline/prompts/step";

export interface StepRequest {
  /** The paper's Files API id, uploaded once by the plan route (section 5.1). */
  paperFileId: string;
  plan: LessonPlanOutput;
  /** Which plan step to write (0-based). The route has checked it's in the plan. */
  n: number;
  /** The previous step's narration, if it has been generated. */
  previousNarration?: string;
  /** The learner's signals so far (section 5.4). */
  signals: readonly Signal[];
}

/** The first attempt's request (pure). The document block is cached for an hour (section 5.1). */
export function buildStepRequest(
  req: StepRequest,
): Anthropic.MessageStreamParams {
  return {
    model: config.models.step,
    max_tokens: config.step.maxTokens,
    system: STEP_SYSTEM_PROMPT,
    output_config: { effort: config.effort.step, format: STEP_OUTPUT_FORMAT },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "file", file_id: req.paperFileId },
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
          { type: "text", text: stepContextPrompt(req) },
        ],
      },
    ],
  };
}

/** Writes and validates step `req.n`. Throws GenerationError. */
export async function generateStep(
  req: StepRequest,
  messages: ClaudeMessages = claudeMessages(config.step.fixture),
): Promise<Step> {
  return generateWithRetry(
    {
      label: `step ${req.n}`,
      request: buildStepRequest(req),
      validate: (json) =>
        validateStep(json, { maxNarrationChars: config.maxNarrationChars }),
      retryPrompt,
      timeoutMs: config.step.timeoutMs,
    },
    messages,
  );
}
