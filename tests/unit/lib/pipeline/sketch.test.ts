// lib/pipeline/sketch.ts and its prompt (ROADMAP SK1, ARCHITECTURE.md section 8): what a sketch
// request sends. The route tests cover the validation and failure cases.
import { describe, expect, it } from "vitest";
import { config } from "@/lib/config";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { SKETCH_OUTPUT_FORMAT, WireSketch } from "@/lib/pipeline/outputFormat";
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
import { TEXT_CHAR_EM, TEXT_SIZE } from "@/shared/boxes";
import { ANSWER_TEMPLATE } from "@/shared/validate";

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
  it("uses the sketch model, medium effort and the output cap from lib/config.ts", () => {
    const body = buildSketchRequest(REQ);
    expect(body.model).toBe(config.models.sketch);
    expect(body.output_config?.effort).toBe("medium");
    expect(config.effort.sketch).toBe("medium");
    expect(body.max_tokens).toBe(config.sketch.maxTokens);
  });

  it("asks for structured output with the sketch output format", () => {
    expect(buildSketchRequest(REQ).output_config?.format).toBe(
      SKETCH_OUTPUT_FORMAT,
    );
  });

  it("the sketch output format is the SDK's JSON schema for the wire sketch, not the contract's Sketch", () => {
    expect(SKETCH_OUTPUT_FORMAT).toEqual({
      type: "json_schema",
      schema: zodOutputFormat(WireSketch).schema,
    });
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

  it("an object's current visibility is sent, not its starting hidden flag", () => {
    const hidden = {
      ...REQ.board.objects[0],
      object: { ...REQ.board.objects[0].object, hidden: true },
      visible: true,
    };
    const text = userText({
      ...REQ,
      board: { ...REQ.board, objects: [hidden] },
    });
    expect(text).toContain('"visible":true');
    expect(text).not.toContain('"hidden"');
  });

  it("moved copies of matrix parts are sent with their source and centre", () => {
    const copy = {
      source: { id: "formula", row: 0 },
      x: 10,
      y: 20,
      visible: true,
    };
    const text = userText({ ...REQ, board: { ...REQ.board, copies: [copy] } });
    expect(text).toContain(JSON.stringify({ movedCopy: copy }));
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

  it("never draws empty matrices as placeholders, and keeps arrows and their labels clear of other objects", () => {
    for (const text of [
      "never draw an empty matrix or empty brackets as a placeholder",
      "draw it as a latex symbol instead, with its size in the formula",
      "place objects so that line passes through no other object and no label",
      "Its label sits beside the middle of the line, so leave free space there",
    ])
      expect(SKETCH_SYSTEM_PROMPT).toContain(text);
  });

  it("lays a fresh answer out from the validator's template: title, content area, takeaway, count, area and gaps", () => {
    const { title, content, takeaway, area, maxContent, maxArrows, gap } =
      ANSWER_TEMPLATE;
    for (const text of [
      `of size "${title.size}", a few words naming the idea, at x ${title.x}, y ${title.y}`,
      `a text object of size "${takeaway.size}", at x ${takeaway.x}, y ${takeaway.y}`,
      `from x ${content.x0} to ${content.x1} and y ${content.y0} to ${content.y1}`,
      `at x ${takeaway.x}, y ${takeaway.y}`,
      `At most ${maxContent} objects besides arrows`,
      `at most ${maxArrows} arrows`,
      `inside x ${area.x0} to ${area.x1} and y ${area.y0} to ${area.y1}`,
      `at least ${gap} apart`,
    ])
      expect(SKETCH_SYSTEM_PROMPT).toContain(text);
  });

  it("gives the sizes the validator estimates with (shared/boxes.ts)", () => {
    expect(SKETCH_SYSTEM_PROMPT).toContain(
      `about ${TEXT_CHAR_EM} of its size wide per character`,
    );
    expect(SKETCH_SYSTEM_PROMPT).toContain(
      `m ${TEXT_SIZE.m}, l ${TEXT_SIZE.l}`,
    );
  });

  it("asks for maths as latex, never _ or ^ in plain text, and a value for every write", () => {
    expect(SKETCH_SYSTEM_PROMPT).toContain(
      'Never write "_" or "^" in a text, a label or a matrix cell',
    );
    expect(SKETCH_SYSTEM_PROMPT).toContain(
      "Every write action needs its value.",
    );
  });

  it("the retry prompt lists every error", () => {
    const text = sketchRetryPrompt(['unknown object "a"', 'duplicate id "b"']);
    expect(text).toContain('- unknown object "a"\n- duplicate id "b"');
  });
});
