// Model-written tex to HTML, through KaTeX only (KATEX_OPTIONS: trust off,
// sizes and macro expansion capped), plus an estimate of the formula's box for
// where arrows stop. Pure apart from a cache: the board redraws every frame
// and a lesson has few formulas, so each tex is rendered once.
import katex from "katex";
import { KATEX_OPTIONS } from "@/shared/latex";
import type { Size } from "./arrowGeometry";
import {
  GLYPH_EM,
  KATEX_EM,
  LATEX_ERROR,
  LATEX_FONT,
  LATEX_PAD,
} from "./style";

export interface RenderedLatex {
  /**
   * KaTeX's HTML: the formula, or for tex it can't parse, the source in
   * `LATEX_ERROR`. Undefined if KaTeX itself failed (e.g. nesting deep enough
   * to overflow the stack): the caller then shows the source as plain text.
   */
  html: string | undefined;
  /** Estimated box of the formula, padding included. */
  size: Size;
}

const rendered = new Map<string, RenderedLatex>();

export function renderLatex(tex: string): RenderedLatex {
  let out = rendered.get(tex);
  if (out === undefined) {
    let html: string | undefined;
    try {
      html = katex.renderToString(tex, {
        ...KATEX_OPTIONS,
        throwOnError: false,
        errorColor: LATEX_ERROR,
      });
    } catch (error) {
      // throwOnError: false only covers parse errors. Logged once per tex.
      console.error("KaTeX failed to render tex", { tex, error });
    }
    out = { html, size: estimateSize(html ?? tex) };
    rendered.set(tex, out);
  }
  return out;
}

/** The visible part of KaTeX's output (the MathML copy is for screen readers). */
const KATEX_HTML_RE = /class="katex-html"[^>]*>([\s\S]*)$/;
/**
 * Each line's height and depth below the baseline, in ems, from the struts
 * KaTeX sizes lines with: `height:1.633em;vertical-align:-0.538em`.
 */
const STRUT_RE =
  /katex-strut" style="height:([\d.]+)em(?:;vertical-align:(-?[\d.]+)em)?/g;
/** A line with no strut (an error, plain text) is one text line high. */
const LINE_EM = 1.2;

/**
 * A formula's box without a layout pass: its height from KaTeX's struts (at
 * least one text line), its width from its glyph count. Stacked parts (fractions, limits) count every
 * glyph, so the width errs wide and arrows stop short rather than overlap.
 */
export function estimateSize(html: string): Size {
  const body = html.match(KATEX_HTML_RE)?.[1] ?? html;
  const struts = [...body.matchAll(STRUT_RE)].map(
    (m) => Number(m[1]) + Math.max(0, -Number(m[2] ?? 0)),
  );
  const text = body
    .replace(/<[^>]*>/g, "")
    .replace(/&[^;]+;/g, "x") // an entity is one glyph
    .replace(/\u200b/g, ""); // KaTeX's zero-width spaces
  const em = LATEX_FONT * KATEX_EM;
  return {
    w: Math.max(1, [...text].length) * em * GLYPH_EM + 2 * LATEX_PAD.x,
    h: Math.max(LINE_EM, ...struts) * em + 2 * LATEX_PAD.y,
  };
}
