// QA A3: a matrix cell's value, and a heatmap's column label, fit their box (player/primitives
// fitText.ts): the font shrinks, words wrap onto up to three lines when that is bigger, and
// past the smallest size the line is squeezed to the box, never wider.
import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Whiteboard } from "@/player/Whiteboard";
import { sceneAt } from "@/player/sceneAt";
import { FIT_CHAR_EM, FIT_LINE_EM, fitText } from "@/player/primitives/fitText";
import { CELL_FONT } from "@/player/primitives/style";
import { BoardState, CELL, type SceneObject } from "@/shared/scene";

const CELL_BOX = { w: CELL.w - 8, h: CELL.h - 6 };
const FONT = { max: CELL_FONT, min: 12 };

describe("fitText", () => {
  it("a short value keeps the full font on one line", () => {
    expect(fitText("19", CELL_BOX, FONT)).toEqual({
      lines: ["19"],
      fontSize: CELL_FONT,
      squeeze: false,
    });
  });

  it("a long number shrinks to fit the cell's width", () => {
    const f = fitText("0.9817", CELL_BOX, FONT);
    expect(f.lines).toEqual(["0.9817"]);
    expect(f.fontSize).toBeLessThan(CELL_FONT);
    expect(6 * f.fontSize * FIT_CHAR_EM).toBeLessThanOrEqual(CELL_BOX.w + 1e-9);
  });

  it("several words wrap onto lines when that lets the font be bigger", () => {
    const f = fitText("BMW truck carrot", CELL_BOX, FONT);
    expect(f.lines).toEqual(["BMW", "truck", "carrot"]);
    expect(f.squeeze).toBe(false);
    expect(f.fontSize).toBeGreaterThan(
      fitText("BMWtruckcarrot", CELL_BOX, FONT).fontSize,
    );
  });

  it("a row of numbers in one cell stacks, one per line", () => {
    const f = fitText("0.9817 0.0180 0.0003", CELL_BOX, FONT);
    expect(f.lines).toEqual(["0.9817", "0.0180", "0.0003"]);
    expect(f.squeeze).toBe(false);
    expect(f.fontSize).toBeGreaterThanOrEqual(FONT.min);
  });

  it("too long for any legible size: the smallest font, squeezed", () => {
    const f = fitText("normalisation probabilities", CELL_BOX, FONT);
    expect(f.fontSize).toBe(FONT.min);
    expect(f.squeeze).toBe(true);
    expect(f.lines).toEqual(["normalisation", "probabilities"]);
  });

  it("whatever the value, its lines fit the box (squeezed lines are pressed to its width)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (text) => {
        const f = fitText(text, CELL_BOX, FONT);
        expect(f.fontSize).toBeGreaterThanOrEqual(FONT.min);
        expect(f.fontSize).toBeLessThanOrEqual(FONT.max);
        expect(f.lines.length * f.fontSize * FIT_LINE_EM).toBeLessThanOrEqual(
          CELL_BOX.h + 1e-9,
        );
        if (!f.squeeze)
          for (const l of f.lines)
            expect(
              [...l].length * f.fontSize * FIT_CHAR_EM,
            ).toBeLessThanOrEqual(CELL_BOX.w + 1e-9);
      }),
    );
  });
});

const render = (objects: SceneObject[]) =>
  renderToStaticMarkup(
    <Whiteboard state={BoardState.parse(sceneAt(objects, [], 0))} />,
  );

describe("on the board", () => {
  it("a matrix cell draws a long value smaller, a wrapped one as stacked lines, a short one as before", () => {
    const html = render([
      {
        kind: "matrix",
        id: "m",
        x: 400,
        y: 300,
        rows: [["0.9817", "BMW truck carrot", "1"]],
      },
    ]);
    const cell = (c: number) =>
      html.match(new RegExp(`data-cell="0,${c}"[\\s\\S]*?</g>`))![0];
    expect(cell(2)).toContain(`font-size="${CELL_FONT}"`);
    expect(cell(2)).toContain(">1</text>");
    expect(cell(0)).not.toContain(`font-size="${CELL_FONT}"`);
    expect(cell(1).match(/<tspan/g)).toHaveLength(3);
    expect(cell(1)).toContain(">carrot</tspan>");
    const squeezed = render([
      { kind: "matrix", id: "m", x: 400, y: 300, rows: [["normalisation"]] },
    ]);
    expect(squeezed).toContain('textLength="56"');
  });

  it("a heatmap's long column label shrinks to its column", () => {
    const html = render([
      {
        kind: "heatmap",
        id: "h",
        x: 300,
        y: 200,
        w: 400,
        h: 300,
        values: [[0.1, 0.9, 0.5, 0.2]],
        colLabels: ["a", "transformer", "b", "c"],
      },
    ]);
    const label = (c: number) =>
      html.match(new RegExp(`data-col-label="${c}"[^>]*`))![0];
    expect(label(0)).toContain('font-size="20"');
    expect(label(1)).not.toContain('font-size="20"');
  });
});
