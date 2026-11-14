// The Q&A agent's client tools (ARCHITECTURE.md section 8): one list, used by
// the agent config in agent/ and the handlers in qa/tools.ts. A test checks
// both match it. No node-only imports.
import { z } from "zod";
import { ObjectId } from "./scene";

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
      "Sketch something on the board. Returns nothing: describe it aloud while it appears.",
    expectsResponse: false,
    parameters: DrawSceneParams,
  },
  {
    name: "simplify_upcoming",
    description: "Ask for the upcoming steps to be made simpler.",
    expectsResponse: false,
    parameters: SimplifyUpcomingParams,
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
