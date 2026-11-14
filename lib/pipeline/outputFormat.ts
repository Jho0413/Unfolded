// The JSON schema a step request sends as its structured-output format (ARCHITECTURE.md
// section 5.1). Kept apart from the generator so it can be swapped for a simpler schema, e.g.
// if the API's compiled grammar for the full one is too large: whatever is sent here, every
// response is still checked against shared/scene.ts's Step by validateStep, and a mismatch is
// a rejection that gets the one retry.
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { Step } from "@/shared/scene";

/** Only the SDK helper's schema is used, not its parser: validateStep parses the response. */
export const STEP_OUTPUT_FORMAT: Anthropic.JSONOutputFormat = {
  type: "json_schema",
  schema: zodOutputFormat(Step).schema,
};
