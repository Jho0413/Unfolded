// Step generation (ARCHITECTURE.md sections 4, 5.1 and 6.2): Claude writes a step in the wire
// format with structured output, it is converted to a Step and validate.ts checks it, and
// lib/pipeline/generate.ts retries a rejection once; a second rejection, a refusal, a cut-off
// or a provider error fails the step. Its paper quotes are checked against the page text
// (./paperQuotes.ts): a miss is retried too, and one still missing after the retry is dropped.
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { LessonPlanOutput, Signal } from "@/shared/lesson";
import type { Step } from "@/shared/scene";
import { config } from "@/lib/config";
import {
  claudeMessages,
  type ClaudeMessages,
  generateWithRetry,
} from "@/lib/pipeline/generate";
import {
  STEP_OUTPUT_FORMAT,
  validateWireStep,
} from "@/lib/pipeline/outputFormat";
import { checkPaperQuotes } from "@/lib/pipeline/paperQuotes";
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
  /**
   * The paper's page text (lib/pipeline/paperPages.ts) to check quotes against (#98), or
   * undefined when there's none: then no quotes are asked for, and any written are dropped.
   */
  paperPages?: readonly string[];
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
          {
            type: "text",
            text: stepContextPrompt({
              ...req,
              paperPageCount: req.paperPages?.length,
            }),
          },
        ],
      },
    ],
  };
}

/**
 * Writes and validates step `req.n`, titled as the plan titles it. Throws GenerationError.
 *
 * The plan's title wins over the one Claude writes: the outline, the Next button, the recap and
 * the agent's go_to_step all name the step by its plan title, and Claude sometimes renamed it
 * (QA pass 2: 2 steps of 10), so the top bar disagreed with the outline.
 */
export async function generateStep(
  req: StepRequest,
  messages: ClaudeMessages = claudeMessages(config.step.fixture),
): Promise<Step> {
  const step = await generateWithRetry(
    {
      label: `step ${req.n}`,
      request: buildStepRequest(req),
      validate: (json) =>
        checkPaperQuotes(
          validateWireStep(json, {
            maxNarrationChars: config.maxNarrationChars,
          }),
          req.paperPages,
        ),
      retryPrompt,
      timeoutMs: config.step.timeoutMs,
    },
    messages,
  );
  return { ...step, title: req.plan.steps[req.n].title };
}
