// How big a board object is drawn, estimated without a layout pass (ARCHITECTURE.md
// sections 4 and 5.3). One source for the renderer (player/primitives: highlight boxes, where
// arrows stop) and the validator (shared/validate.ts: a fresh sketch stays inside the answer
// area), so both use the same sizes. Imported by the server and the browser, so no node-only
// imports. Estimates err wide: the renderer draws what overflows, and the validator rejects
// a little early rather than late.
import katex from "katex";
import { KATEX_OPTIONS } from "./latex";
import { type BoardObject, CELL } from "./scene";

/** A box's width and height. */
export interface Size {
  w: number;
  h: number;
}

/** A box's edges on the canvas. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Font size (px) of a text object's `size`. */
export const TEXT_SIZE = { s: 24, m: 32, l: 48 } as const;

/** A text's average character width, in ems: errs wide for the board's serif. */
export const TEXT_CHAR_EM = 0.62;

/**
 * A text's box (a text object's highlight, where arrows stop, an arrow label), from a rough
 * width: a pure render has no layout pass to measure the text.
 */
export function textBox(text: string, fontSize: number): Size {
  const width = Math.max(1, [...text].length) * fontSize * TEXT_CHAR_EM;
  return { w: width + fontSize, h: fontSize * 1.4 };
}

/** Font size (px) a latex object's formula is set in: the size of a medium text. */
export const LATEX_FONT = TEXT_SIZE.m;
/** Padding (px) around a formula, inside its highlight box. */
export const LATEX_PAD = { x: 12, y: 4 } as const;
/** KaTeX sets formulas at 1.21em of the surrounding font (its stylesheet). */
export const KATEX_EM = 1.21;
/** Average formula glyph width, in ems, for estimating a formula's width. */
export const GLYPH_EM = 0.6;

/** The visible part of KaTeX's output (the MathML copy is for screen readers). */
const KATEX_HTML_RE = /class="katex-html"[^>]*>([\s\S]*)$/;
/**
 * Each line's height and depth below the baseline, in ems, from the struts
 * KaTeX sizes lines with: `height:1.633em;vertical-align:-0.538em`.
 */
const STRUT_RE =
  /katex-strut" style="height:([\d.]+)em(?:;vertical-align:(-?[\d.]+)em)?/g;
/** A line with no strut (an error, plain text) is one text line high. */
export const LATEX_LINE_EM = 1.2;

/**
 * A formula's box from KaTeX's HTML: its height from KaTeX's struts (at least one text line),
 * its width from its glyph count. Stacked parts (fractions, limits) count every glyph, so the
 * width errs wide and arrows stop short rather than overlap.
 */
export function estimateSize(html: string): Size {
  const body = html.match(KATEX_HTML_RE)?.[1] ?? html;
  const struts = [...body.matchAll(STRUT_RE)].map(
    (m) => Number(m[1]) + Math.max(0, -Number(m[2] ?? 0)),
  );
  const text = body
    .replace(/<[^>]*>/g, "")
    .replace(/&[^;]+;/g, "x") // an entity is one glyph
    .replace(/​/g, ""); // KaTeX's zero-width spaces
  const em = LATEX_FONT * KATEX_EM;
  return {
    w: Math.max(1, [...text].length) * em * GLYPH_EM + 2 * LATEX_PAD.x,
    h: Math.max(LATEX_LINE_EM, ...struts) * em + 2 * LATEX_PAD.y,
  };
}

/** A formula's estimated box; tex KaTeX can't render at all is sized as its source. */
export function latexSize(tex: string): Size {
  try {
    return estimateSize(
      katex.renderToString(tex, { ...KATEX_OPTIONS, throwOnError: false }),
    );
  } catch {
    return estimateSize(tex);
  }
}

/** How a matrix's brackets and label sit around its cell box (player/primitives/Matrix.tsx). */
export const MATRIX_FRAME = {
  /** Brackets sit this far outside the cell box. */
  bracketGap: 6,
  bracketSerif: 10,
  labelFont: 28,
  /** The label's baseline is this far above the brackets' top. */
  labelLift: 18,
} as const;

/**
 * An object's estimated box on the canvas: a matrix's cells with its brackets and label, a
 * text's or formula's box centred on its x,y, an image's box. Undefined for an arrow (it runs
 * between other objects and points, checked on their own).
 */
export function objectBox(obj: BoardObject): Box | undefined {
  switch (obj.kind) {
    case "matrix": {
      const { bracketGap, labelFont, labelLift } = MATRIX_FRAME;
      const w = obj.rows[0].length * CELL.w;
      const h = obj.rows.length * CELL.h;
      const box = {
        x0: obj.x - bracketGap,
        y0: obj.y - bracketGap,
        x1: obj.x + w + bracketGap,
        y1: obj.y + h + bracketGap,
      };
      if (!obj.label) return box;
      const label = textBox(obj.label, labelFont);
      const cx = obj.x + w / 2;
      return {
        x0: Math.min(box.x0, cx - label.w / 2),
        // From the baseline up a whole font size: errs above the cap height.
        y0: box.y0 - labelLift - labelFont,
        x1: Math.max(box.x1, cx + label.w / 2),
        y1: box.y1,
      };
    }
    case "text":
      return centred(obj, textBox(obj.text, TEXT_SIZE[obj.size ?? "m"]));
    case "latex":
      return centred(obj, latexSize(obj.tex));
    case "image":
      return { x0: obj.x, y0: obj.y, x1: obj.x + obj.w, y1: obj.y + obj.h };
    case "arrow":
      return undefined;
  }
}

function centred(at: { x: number; y: number }, size: Size): Box {
  return {
    x0: at.x - size.w / 2,
    y0: at.y - size.h / 2,
    x1: at.x + size.w / 2,
    y1: at.y + size.h / 2,
  };
}

/**
 * The clear space between two boxes: across the wider of the horizontal and vertical gaps,
 * 0 when they touch, negative when they overlap.
 */
export function boxGap(a: Box, b: Box): number {
  return Math.max(b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1);
}

/** Whether `inner` lies inside `outer`, edges included. */
export function boxInside(inner: Box, outer: Box): boolean {
  return (
    inner.x0 >= outer.x0 &&
    inner.y0 >= outer.y0 &&
    inner.x1 <= outer.x1 &&
    inner.y1 <= outer.y1
  );
}
