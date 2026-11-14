// The JSON schemas the step and sketch requests send as their structured-output format
// (ARCHITECTURE.md sections 5.1 and 8). Kept apart from the generators so they can be swapped
// for simpler schemas, e.g. if the API's compiled grammar for the full one is too large:
// whatever is sent here, every response is still checked against shared/scene.ts's Step or
// Sketch by validateStep or validateSketch, and a mismatch is a rejection that gets the one
// retry.
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { Sketch, Step } from "@/shared/scene";

/** Only the SDK helper's schemas are used, not its parser: validate.ts parses the response. */
export const STEP_OUTPUT_FORMAT: Anthropic.JSONOutputFormat = {
  type: "json_schema",
  schema: zodOutputFormat(Step).schema,
};

export const SKETCH_OUTPUT_FORMAT: Anthropic.JSONOutputFormat = {
  type: "json_schema",
  schema: zodOutputFormat(Sketch).schema,
};
