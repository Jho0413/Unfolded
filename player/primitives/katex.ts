// Model-written tex to HTML, through KaTeX only (KATEX_OPTIONS: trust off,
// sizes and macro expansion capped), plus an estimate of the formula's box for
// where arrows stop (shared/boxes.ts, which the validator uses too). Pure apart from a cache: the board redraws every frame
// and a lesson has few formulas, so each tex is rendered once.
import katex from "katex";
import { KATEX_OPTIONS } from "@/shared/latex";
import { latexSize, type Size } from "@/shared/boxes";
import { LATEX_ERROR } from "./style";

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
    out = { html, size: latexSize(tex) };
    rendered.set(tex, out);
  }
  return out;
}
