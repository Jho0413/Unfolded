import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CLIENT_TOOL_NAMES, CLIENT_TOOLS } from "@/shared/tools";
import { z } from "zod";
import { CELL, cellCentre, OBJECT_ID_RE, Sketch, Step } from "@/shared/scene";
import { LessonPlan, LessonPlanOutput } from "@/shared/lesson";
import { parseNarration } from "@/shared/validate";

const cueName = fc.stringMatching(/^[a-z][a-z0-9_]{0,31}$/);
/** Plain narration text: no brackets, so it can't form a marker. */
const plainText = fc.string({
  unit: fc.constantFrom(..."ab cdé😀,.\n".split("")),
});

describe("cue markers (property)", () => {
  it("every well-formed marker is read as a cue, in order, and stripped from the spoken text", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(plainText, cueName)),
        plainText,
        (parts, tail) => {
          const narration =
            parts.map(([t, c]) => `${t}[[${c}]]`).join("") + tail;
          const parsed = parseNarration(narration);
          expect(parsed.cues).toEqual(parts.map(([, c]) => c));
          expect(parsed.malformed).toEqual([]);
          expect(parsed.spoken).not.toMatch(/\[\[|\]\]/);
          const expected = (parts.map(([t]) => t).join("") + tail)
            .trim()
            .replace(/\s+/g, " ");
          expect(parsed.spoken).toBe(expected);
        },
      ),
    );
  });

  it("a [[...]] whose name breaks the regex is malformed, never a cue", () => {
    const badName = fc
      .string()
      .filter((s) => !/^[a-z][a-z0-9_]{0,31}$/.test(s) && !/[[\]]/.test(s));
    fc.assert(
      fc.property(plainText, badName, plainText, (a, name, b) => {
        const parsed = parseNarration(`${a}[[${name}]]${b}`);
        expect(parsed.cues).toEqual([]);
        expect(parsed.malformed).toEqual([`[[${name}]]`]);
      }),
    );
  });

  it("text with any [[ or ]] left after removing valid markers is always reported", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom("[", "]", "a", " ", "_", "1") }),
        (s) => {
          const parsed = parseNarration(s);
          const leftover = s.replace(
            /\[\[([a-z][a-z0-9_]{0,31})\]\]/g,
            "\u0000",
          );
          if (/\[\[|\]\]/.test(leftover))
            expect(parsed.malformed.length).toBeGreaterThan(0);
        },
      ),
    );
  });
});

describe("object ids (property)", () => {
  it("OBJECT_ID_RE accepts exactly lowercase ids of 1..32 chars starting with a letter", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (s) => {
        const expected =
          s.length >= 1 &&
          s.length <= 32 &&
          /[a-z]/.test(s[0]) &&
          [...s].every((ch) => /[a-z0-9_]/.test(ch));
        expect(OBJECT_ID_RE.test(s)).toBe(expected);
      }),
    );
  });
});

describe("geometry", () => {
  it("cell (r, c) centre is (x + 64c + 32, y + 48r + 24)", () => {
    expect(CELL).toEqual({ w: 64, h: 48 });
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer(),
        fc.nat(7),
        fc.nat(7),
        (x, y, r, c) => {
          expect(cellCentre(x, y, r, c)).toEqual({
            x: x + 64 * c + 32,
            y: y + 48 * r + 24,
          });
        },
      ),
    );
  });
});

describe("schema details", () => {
  it("the Step and Sketch JSON schemas use anyOf, never oneOf (structured output doesn't list oneOf)", () => {
    for (const schema of [Step, Sketch]) {
      const json = JSON.stringify(z.toJSONSchema(schema, { io: "input" }));
      expect(json).not.toContain('"oneOf"');
      expect(json).toContain('"anyOf"');
    }
  });

  it("a cue must look like a marker name", () => {
    const base = {
      title: "t",
      narration: "n",
      objects: [{ kind: "text", id: "t", x: 1, y: 1, text: "" }],
    };
    expect(
      Step.safeParse({
        ...base,
        actions: [{ cue: "Row 1", do: "show", target: { id: "t" } }],
      }).success,
    ).toBe(false);
  });

  it("durationMs defaults to 400 and is capped at 3000", () => {
    const base = {
      title: "t",
      narration: "[[a]]x",
      objects: [{ kind: "text", id: "t", x: 1, y: 1, text: "" }],
    };
    const parsed = Step.parse({
      ...base,
      actions: [{ cue: "a", do: "show", target: { id: "t" } }],
    });
    expect(parsed.actions[0].durationMs).toBe(400);
    expect(
      Step.safeParse({
        ...base,
        actions: [
          { cue: "a", do: "show", target: { id: "t" }, durationMs: 3001 },
        ],
      }).success,
    ).toBe(false);
  });

  it("a matrix is 1..8 x 1..8 and rectangular", () => {
    const m = (rows: string[][]) =>
      Step.safeParse({
        title: "t",
        narration: "n",
        objects: [{ kind: "matrix", id: "m", x: 0, y: 0, rows }],
        actions: [],
      }).success;
    expect(m([["1"]])).toBe(true);
    expect(m([])).toBe(false);
    expect(m([[]])).toBe(false);
    expect(m(Array.from({ length: 9 }, () => ["1"]))).toBe(false);
    expect(m([Array.from({ length: 9 }, () => "1")])).toBe(false);
    expect(m([["1", "2"], ["3"]])).toBe(false);
  });

  it("the plan Claude writes has coverPrompt but no cover; the saved plan may add cover", () => {
    const plan = {
      title: "Attention",
      steps: [{ title: "Dot product", goal: "g" }],
      coverPrompt: "a lighthouse",
    };
    expect(
      LessonPlanOutput.parse({ ...plan, cover: "cover.png" }),
    ).not.toHaveProperty("cover");
    expect(LessonPlan.parse({ ...plan, cover: "cover.png" }).cover).toBe(
      "cover.png",
    );
    expect(LessonPlan.safeParse({ ...plan, cover: "../x" }).success).toBe(
      false,
    );
    expect(
      LessonPlanOutput.safeParse({
        title: "t",
        steps: [{ title: "s", goal: "g" }],
      }).success,
    ).toBe(false);
  });
});

describe("client tools (ARCHITECTURE.md section 8)", () => {
  it("is one list with the four tools, their waits and their parameters", () => {
    expect(CLIENT_TOOL_NAMES).toEqual([
      "highlight",
      "go_to_step",
      "draw_scene",
      "simplify_upcoming",
    ]);
    const waits = Object.fromEntries(
      CLIENT_TOOLS.map((t) => [t.name, t.expectsResponse]),
    );
    expect(waits).toEqual({
      highlight: true,
      go_to_step: true,
      draw_scene: false,
      simplify_upcoming: false,
    });
    const params = Object.fromEntries(
      CLIENT_TOOLS.map((t) => [t.name, Object.keys(t.parameters.shape).sort()]),
    );
    expect(params).toEqual({
      highlight: ["col", "row", "target_id"],
      go_to_step: ["step"],
      draw_scene: ["description", "fresh"],
      simplify_upcoming: ["reason"],
    });
  });

  it("go_to_step is 1-based and draw_scene defaults fresh to false", () => {
    const [, goTo, draw] = CLIENT_TOOLS;
    expect(goTo.parameters.safeParse({ step: 0 }).success).toBe(false);
    expect(goTo.parameters.safeParse({ step: 1 }).success).toBe(true);
    expect(draw.parameters.parse({ description: "a cat" })).toEqual({
      description: "a cat",
      fresh: false,
    });
  });
});
