// The Q&A agent's client tools (ARCHITECTURE.md section 8): one list, used by
// the agent config in agent/ and the handlers in qa/tools.ts. A test checks
// both match it. No node-only imports.
import { z } from "zod";
import { MAX_PAPER_QUOTE_CHARS, ObjectId } from "./scene";

const index = z.number().int().min(0);

export const HighlightParams = z.object({
  target_id: ObjectId.describe("Id of an object on the current board"),
  row: index.optional().describe("0-based matrix row"),
  col: index.optional().describe("0-based matrix column"),
});

export const GoToStepParams = z.object({
  step: z.number().int().min(1).describe("Step number, 1-based, as spoken"),
});

export const DrawSceneParams = z.object({
  description: z.string().min(1).describe("What to draw, in plain words"),
  fresh: z
    .boolean()
    .default(false)
    .describe("True to draw on an empty board instead of the current one"),
});

export const SimplifyUpcomingParams = z.object({
  reason: z.string().min(1).describe("Why the learner needs it simpler"),
});

/**
 * highlight_paper (issue #98): scrolls the paper viewer to a passage and highlights it. The
 * quote is found with shared/paperText.ts `findQuote`, on `page` first, then on any page.
 */
export const HighlightPaperParams = z.object({
  quote: z
    .string()
    .min(1)
    .max(MAX_PAPER_QUOTE_CHARS)
    .describe("A short verbatim quote from the document, a sentence or less"),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("1-based page of the document the quote is on, if known"),
});

/** The lesson control tools take nothing: they act on the step on screen. */
export const NoParams = z.object({});

export const CLIENT_TOOLS = [
  {
    name: "highlight",
    description:
      "Highlight an object, or a row, column or cell of a matrix, on the current board.",
    expectsResponse: true,
    parameters: HighlightParams,
  },
  {
    name: "go_to_step",
    description:
      "Jump to a lesson step. It loads, paused, once the question is over.",
    expectsResponse: true,
    parameters: GoToStepParams,
  },
  {
    name: "draw_scene",
    description:
      "Show the answer as a narrated drawing on a clean answer board: the lesson's narrator explains it while it draws. Waits until it has played, then returns what was said (or that the learner spoke over it, or why it couldn't be drawn). Stay quiet until then.",
    expectsResponse: true,
    parameters: DrawSceneParams,
  },
  {
    name: "highlight_paper",
    description:
      "Scroll the document beside the board to a passage and highlight it. Returns ok, or why it couldn't.",
    expectsResponse: true,
    parameters: HighlightPaperParams,
  },
  {
    name: "simplify_upcoming",
    description: "Ask for the upcoming steps to be made simpler.",
    expectsResponse: false,
    parameters: SimplifyUpcomingParams,
  },
  // Lesson control (issue #93): the learner's spoken commands. No wait, so the agent never
  // speaks after one; each acts once the agent has finished speaking.
  {
    name: "resume_lesson",
    description:
      "Carry on with the lesson from where it stopped (after a go_to_step jump, that step starts).",
    expectsResponse: false,
    parameters: NoParams,
  },
  {
    name: "pause_lesson",
    description:
      "Hold the lesson where it is until the learner says to carry on.",
    expectsResponse: false,
    parameters: NoParams,
  },
  {
    name: "next_step",
    description: "Skip ahead to the next step; it starts at once.",
    expectsResponse: false,
    parameters: NoParams,
  },
  {
    name: "previous_step",
    description: "Go back to the previous step; it starts at once.",
    expectsResponse: false,
    parameters: NoParams,
  },
  {
    name: "replay_step",
    description: "Say the current step again from its start.",
    expectsResponse: false,
    parameters: NoParams,
  },
] as const;

export type ClientTool = (typeof CLIENT_TOOLS)[number];
export type ClientToolName = ClientTool["name"];
export const CLIENT_TOOL_NAMES = CLIENT_TOOLS.map(
  (t) => t.name,
) as readonly ClientToolName[];

/** Parameters each tool's handler receives, by tool name. */
export type ClientToolParams = {
  [T in ClientTool as T["name"]]: z.infer<T["parameters"]>;
};
