// lib/pipeline/sketch.ts and its prompt (ROADMAP SK1, ARCHITECTURE.md section 8): what a sketch
// request sends. The route tests cover the validation and failure cases.
import { describe, expect, it } from "vitest";
import { config } from "@/lib/config";
import { SKETCH_OUTPUT_FORMAT } from "@/lib/pipeline/outputFormat";
import {
  SKETCH_SYSTEM_PROMPT,
  sketchRetryPrompt,
} from "@/lib/pipeline/prompts/sketch";
import { STEP_SYSTEM_PROMPT } from "@/lib/pipeline/prompts/step";
import {
  BOARD_ACTIONS_PROMPT,
  BOARD_OBJECTS_PROMPT,
} from "@/lib/pipeline/prompts/board";
import {
  buildSketchRequest,
  type SketchRequestBody,
} from "@/lib/pipeline/sketch";

const REQ: SketchRequestBody = {
  description: "why the row goes with the column",
  fresh: false,
  board: {
    objects: [
      {
        object: { kind: "latex", id: "formula", x: 800, y: 450, tex: "x" },
        visible: false,
        highlight: "warn",
      },
    ],
    copies: [],
    active: [],
  },
};

const userText = (req: SketchRequestBody) => {
  const content = buildSketchRequest(req).messages[0].content;
  if (typeof content !== "string") throw new Error("expected a string prompt");
  return content;
};

describe("buildSketchRequest", () => {
  it("uses the sketch model, low effort and the output cap from lib/config.ts", () => {
    const body = buildSketchRequest(REQ);
    expect(body.model).toBe(config.models.sketch);
    expect(body.output_config?.effort).toBe("low");
    expect(config.effort.sketch).toBe("low");
    expect(body.max_tokens).toBe(config.sketch.maxTokens);
  });

  it("asks for structured output with the sketch output format", () => {
    expect(buildSketchRequest(REQ).output_config?.format).toBe(
      SKETCH_OUTPUT_FORMAT,
    );
  });

  it("the system prompt is the same constant for every request", () => {
    expect(buildSketchRequest(REQ).system).toBe(SKETCH_SYSTEM_PROMPT);
    expect(buildSketchRequest({ ...REQ, fresh: true }).system).toBe(
      SKETCH_SYSTEM_PROMPT,
    );
  });

  it("sends the board's objects, with their ids, visibility and highlight, and the description as data", () => {
    const text = userText(REQ);
    expect(text).toContain(JSON.stringify(REQ.board.objects[0]));
    expect(text).toContain(`<description>\n${REQ.description}\n</description>`);
  });

  it("with fresh: true, the board isn't sent: it says the board is empty", () => {
    const text = userText({ ...REQ, fresh: true });
    expect(text).toContain("The board is empty.");
    expect(text).not.toContain('"formula"');
  });

  it("an empty board says the board is empty", () => {
    const text = userText({
      ...REQ,
      board: { objects: [], copies: [], active: [] },
    });
    expect(text).toContain("The board is empty.");
  });
});

describe("the sketch prompt", () => {
  it("describes the board exactly as the step prompt does (one shared text)", () => {
    for (const part of [BOARD_OBJECTS_PROMPT, BOARD_ACTIONS_PROMPT]) {
      expect(SKETCH_SYSTEM_PROMPT).toContain(part);
      expect(STEP_SYSTEM_PROMPT).toContain(part);
    }
  });

  it("the retry prompt lists every error", () => {
    const text = sketchRetryPrompt(['unknown object "a"', 'duplicate id "b"']);
    expect(text).toContain('- unknown object "a"\n- duplicate id "b"');
  });
});
