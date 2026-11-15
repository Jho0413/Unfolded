// lib/pipeline/sketch.ts and its prompt (ROADMAP SK1, ARCHITECTURE.md section 8): what a sketch
// request sends. The route tests cover the validation and failure cases.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { config } from "@/lib/config";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { SKETCH_OUTPUT_FORMAT, WireSketch } from "@/lib/pipeline/outputFormat";
import {
  MAX_MATRIX_LABEL_CHARS,
  SKETCH_SYSTEM_PROMPT,
  charsInSlot,
  rowSlots,
  sketchRetryPrompt,
} from "@/lib/pipeline/prompts/sketch";
import { STEP_SYSTEM_PROMPT } from "@/lib/pipeline/prompts/step";
import {
  BOARD_ACTIONS_PROMPT,
  BOARD_OBJECTS_PROMPT,
  NARRATION_RULES_PROMPT,
} from "@/lib/pipeline/prompts/board";
import {
  buildSketchRequest,
  streamedNarration,
  type SketchRequestBody,
} from "@/lib/pipeline/sketch";
import { MATRIX_FRAME, TEXT_CHAR_EM, TEXT_SIZE, textBox } from "@/shared/boxes";
import { ANSWER_TEMPLATE } from "@/shared/validate";

const REQ: SketchRequestBody = {
  description: "why the row goes with the column",
  lessonId: "lesson-1",
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
  it("uses the sketch model, low effort (#105) and the output cap from lib/config.ts", () => {
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
  it("describes the board, and how a narration is spoken and cued, exactly as the step prompt does (one shared text)", () => {
    for (const part of [
      BOARD_OBJECTS_PROMPT,
      BOARD_ACTIONS_PROMPT,
      NARRATION_RULES_PROMPT,
    ]) {
      expect(SKETCH_SYSTEM_PROMPT).toContain(part);
      expect(STEP_SYSTEM_PROMPT).toContain(part);
    }
  });

  it("asks for a short narration within ANSWER_TEMPLATE.maxNarrationChars, with every action on a cue (#105)", () => {
    expect(SKETCH_SYSTEM_PROMPT).toContain(
      `at most ${ANSWER_TEMPLATE.maxNarrationChars} characters`,
    );
    expect(SKETCH_SYSTEM_PROMPT).toContain("Each action has a cue");
    expect(SKETCH_SYSTEM_PROMPT).not.toContain("atMs");
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

describe("the answer board's slots (rejected sketches placed items by eye near an edge)", () => {
  const { content, gap } = ANSWER_TEMPLATE;

  it.each([2, 3, 4])(
    "a row of %i items splits the content area into equal slots, edge to edge",
    (n) => {
      const slots = rowSlots(n);
      expect(slots).toHaveLength(n);
      expect(slots[0].x0).toBe(content.x0);
      expect(slots.at(-1)!.x1).toBe(content.x1);
      for (let i = 1; i < n; i++) expect(slots[i].x0).toBe(slots[i - 1].x1);
      const widths = slots.map((s) => s.x1 - s.x0);
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    },
  );

  it("the prompt gives the slots of a row of two, three and four, with their centres", () => {
    for (const n of [2, 3, 4])
      for (const { x0, x1 } of rowSlots(n))
        expect(SKETCH_SYSTEM_PROMPT).toContain(
          `x ${x0} to ${x1} (centre ${(x0 + x1) / 2})`,
        );
  });

  it("a matrix label of MAX_MATRIX_LABEL_CHARS fits a slot of three with the gap to spare, one more doesn't", () => {
    const slot = rowSlots(3)[0];
    const width = (chars: number) =>
      textBox("x".repeat(chars), MATRIX_FRAME.labelFont).w;
    expect(width(MAX_MATRIX_LABEL_CHARS) + gap).toBeLessThanOrEqual(
      slot.x1 - slot.x0,
    );
    expect(width(MAX_MATRIX_LABEL_CHARS + 1) + gap).toBeGreaterThan(
      slot.x1 - slot.x0,
    );
    expect(SKETCH_SYSTEM_PROMPT).toContain(
      `at most ${MAX_MATRIX_LABEL_CHARS} characters (two or three words)`,
    );
  });

  it.each([2, 3])(
    "a size-s note of charsInSlot(%i) characters fits its slot, one more doesn't",
    (n) => {
      const slot = rowSlots(n)[0];
      const chars = charsInSlot(n, TEXT_SIZE.s);
      const width = (c: number) => textBox("x".repeat(c), TEXT_SIZE.s).w;
      expect(width(chars) + gap).toBeLessThanOrEqual(slot.x1 - slot.x0);
      expect(width(chars + 1) + gap).toBeGreaterThan(slot.x1 - slot.x0);
      expect(SKETCH_SYSTEM_PROMPT).toMatch(
        new RegExp(
          `\\b${chars}( characters)? in a slot of ${n === 2 ? "two" : "three"}`,
        ),
      );
    },
  );
});

describe("streamedNarration: the narration of a sketch still streaming", () => {
  it.each([
    ["nothing yet", "", undefined],
    ["the key, not its value", '{"narration":', undefined],
    ["a string still open", '{"narration":"Here it', undefined],
    ["an escape still open", '{"narration":"Here \\', undefined],
    [
      "a closed string",
      '{"narration":"Here it is.","objects":[',
      "Here it is.",
    ],
    [
      "the whole answer",
      '{"narration":"[[c]]Hi.","objects":[],"actions":[]}',
      "[[c]]Hi.",
    ],
    ["spaces and newlines around", '\n{ \n "narration" : "Hi." ,', "Hi."],
    [
      "escaped quotes and a backslash",
      '{"narration":"say \\"hi\\" \\\\ ok","objects"',
      'say "hi" \\ ok',
    ],
    ["a Unicode escape", '{"narration":"caf\\u00e9","', "café"],
    ["the empty narration", '{"narration":"",', ""],
    [
      "narration not the first field",
      '{"objects":[],"narration":"Hi."',
      undefined,
    ],
    ["text before the object", 'Sure: {"narration":"Hi."', undefined],
    ["a bad escape", '{"narration":"\\x41",', undefined],
  ])("%s", (_name, text, expected) => {
    expect(streamedNarration(text)).toBe(expected);
  });

  it("property: every prefix of a wire sketch gives nothing, or exactly its narration", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (narration) => {
        const text = JSON.stringify({ narration, objects: [], actions: [] });
        for (let i = 0; i <= text.length; i++) {
          const got = streamedNarration(text.slice(0, i));
          if (got !== undefined) expect(got).toBe(narration);
        }
        expect(streamedNarration(text)).toBe(narration);
      }),
    );
  });
});
