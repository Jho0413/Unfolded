// Repairs maths written into plain text (#90). The answer template wants maths in latex
// objects, but the sketch model sometimes writes "d_k" or "x^2" into a text, a label, a matrix
// cell or a written value, where it would show raw. Rejecting the whole drawing for that cost
// learners their answer, so the server rewrites it instead, before validation: scripts become
// Unicode sub- and superscripts where they exist ("d_k" → "dₖ", "x^2" → "x²", "K^T" → "Kᵀ"),
// and otherwise a space ("W_Q" → "W Q"). The validator's "_" or "^" rule (shared/validate.ts)
// stays as the backstop. Pure.
import type { Action, BoardObject, Sketch } from "./scene";

const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ",
  r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
}; // prettier-ignore

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ",
  m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ",
  z: "ᶻ", T: "ᵀ",
}; // prettier-ignore

/** A script's body: `{…}` or one character. */
const SCRIPT_RE = /([_^])(?:\{([^{}]*)\}|([^\s{}]))/g;

/** Plain text with its "_" and "^" scripts rewritten (pure). Text without them is unchanged. */
export function repairPlainMaths(text: string): string {
  if (!/[_^]/.test(text)) return text;
  const out = text.replace(
    SCRIPT_RE,
    (_m, mark: string, braced?: string, single?: string) => {
      const body = braced ?? single ?? "";
      const table = mark === "_" ? SUB : SUP;
      const chars = [...body];
      if (chars.length > 0 && chars.every((c) => c in table))
        return chars.map((c) => table[c]).join("");
      return ` ${body}`;
    },
  );
  // Any "_" or "^" left (e.g. at the end of the text) becomes a space.
  return out.replace(/[_^]/g, " ").replace(/ {2,}/g, " ").trim();
}

function repairObject(obj: BoardObject): BoardObject {
  switch (obj.kind) {
    case "text":
      return { ...obj, text: repairPlainMaths(obj.text) };
    case "matrix":
      return {
        ...obj,
        rows: obj.rows.map((r) => r.map(repairPlainMaths)),
        ...(obj.label !== undefined && { label: repairPlainMaths(obj.label) }),
      };
    case "arrow":
      return obj.label !== undefined
        ? { ...obj, label: repairPlainMaths(obj.label) }
        : obj;
    case "latex":
    case "image":
      return obj;
  }
}

function repairAction<A extends Action>(action: A): A {
  return action.do === "write"
    ? { ...action, value: repairPlainMaths(action.value) }
    : action;
}

/** The sketch with every plain text's maths repaired (pure); latex objects are untouched. */
export function repairSketchPlainMaths(sketch: Sketch): Sketch {
  return {
    ...sketch,
    objects: sketch.objects.map(repairObject),
    actions: sketch.actions.map(repairAction),
  };
}
