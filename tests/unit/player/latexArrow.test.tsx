// The latex and arrow primitives (ROADMAP P7). The browser checks are in
// tests/e2e/board.spec.ts; these cover the pure helpers: arrow geometry, and
// how model-written tex becomes HTML (KaTeX, with trust off).
import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXED, sceneState } from "@/app/dev/board/scenes";
import { Whiteboard } from "@/player/Whiteboard";
import { latexHtml } from "@/player/primitives/Latex";
import { arrowGeometry, targetBox } from "@/player/primitives/arrowGeometry";
import {
  ARROW,
  LATEX_ARROW_BOX,
  TEXT_SIZE,
  textBox,
} from "@/player/primitives/style";
import { CELL } from "@/shared/scene";
import { errors, validateStep } from "@/shared/validate";

describe("arrowGeometry", () => {
  const box = { w: 40, h: 20 };

  it("point ends: the tip is exactly on the end, the line stops at the head", () => {
    const g = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 })!;
    expect([g.x1, g.y1]).toEqual([0, 0]);
    expect([g.x2, g.y2]).toEqual([100 - ARROW.head.len, 0]);
    const half = ARROW.head.w / 2;
    expect(g.head).toBe(`100,0 82,${-half} 82,${half}`);
  });

  it("target ends stop the margin outside each box", () => {
    // Horizontal: the box's half width (20) plus the margin.
    const g = arrowGeometry({ x: 0, y: 0 }, { x: 200, y: 0 }, box, box)!;
    expect(g.x1).toBe(20 + ARROW.margin);
    expect(g.head.startsWith(`${200 - 20 - ARROW.margin},0 `)).toBe(true);
    // Vertical: its half height (10).
    const v = arrowGeometry({ x: 0, y: 0 }, { x: 0, y: 200 }, box)!;
    expect(v.y1).toBe(10 + ARROW.margin);
    // Diagonal through the corner region: the nearer edge wins (half height / sin).
    const d = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 100 }, box)!;
    expect(Math.hypot(d.x1, d.y1)).toBeCloseTo(10 * Math.SQRT2 + ARROW.margin);
  });

  it("a short arrow: insets take at most half its length", () => {
    // 40 long, 2 x 30 of insets: scaled to 20 in all, so it runs 10..30.
    const g = arrowGeometry({ x: 0, y: 0 }, { x: 40, y: 0 }, box, box)!;
    expect(g.x1).toBeCloseTo(10);
    expect(g.head.startsWith("30,0 ")).toBe(true);
  });

  it("ends that coincide: nothing to draw", () => {
    expect(arrowGeometry({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(undefined);
  });

  it("the label sits above a horizontal line and left of a vertical one", () => {
    const h = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 })!;
    expect(h.label).toEqual({ x: 50, y: -ARROW.labelOffset });
    const v = arrowGeometry({ x: 0, y: 0 }, { x: 0, y: 100 })!;
    expect(v.label.x).toBeCloseTo(-ARROW.labelOffset);
    expect(v.label.y).toBeCloseTo(50);
  });

  it("property: start, head base and tip run in order along from -> to, insets take at most half, the label is never below the line", () => {
    const coord = fc.double({ min: 0, max: 1600, noNaN: true });
    const size = fc.option(
      fc.record({
        w: fc.double({ min: 1, max: 600, noNaN: true }),
        h: fc.double({ min: 1, max: 600, noNaN: true }),
      }),
      { nil: undefined },
    );
    const eps = 1e-6;
    fc.assert(
      fc.property(
        coord,
        coord,
        coord,
        coord,
        size,
        size,
        (a, b, c, d, i, j) => {
          const len = Math.hypot(c - a, d - b);
          const g = arrowGeometry({ x: a, y: b }, { x: c, y: d }, i, j);
          if (len < eps) return g === undefined;
          if (!g) return false;
          const [tx, ty] = g.head.split(" ")[0].split(",").map(Number);
          const along = (x: number, y: number) => Math.hypot(x - a, y - b);
          const start = along(g.x1, g.y1);
          const base = along(g.x2, g.y2);
          const tip = along(tx, ty);
          const midY = (g.y1 + ty) / 2;
          return (
            start <= base + eps &&
            base <= tip + eps &&
            tip <= len + eps &&
            start + (len - tip) <= len / 2 + eps &&
            g.label.y <= midY + eps
          );
        },
      ),
    );
  });
});

describe("targetBox", () => {
  it("points have no box; matrices, their parts, texts, latex and images do", () => {
    expect(targetBox(FIXED, { x: 1, y: 1 })).toBe(undefined);
    expect(targetBox(FIXED, { id: "nope" })).toBe(undefined);
    expect(targetBox(FIXED, { id: "m" })).toEqual({
      w: 3 * CELL.w,
      h: 3 * CELL.h,
    });
    expect(targetBox(FIXED, { id: "m", row: 1 })).toEqual({
      w: 3 * CELL.w,
      h: CELL.h,
    });
    expect(targetBox(FIXED, { id: "m", col: 0 })).toEqual({
      w: CELL.w,
      h: 3 * CELL.h,
    });
    expect(targetBox(FIXED, { id: "m", row: 0, col: 0 })).toEqual(CELL);
    expect(targetBox(FIXED, { id: "large" })).toEqual(
      textBox("large", TEXT_SIZE.l),
    );
    expect(targetBox(FIXED, { id: "eq" })).toEqual(LATEX_ARROW_BOX);
    expect(targetBox(FIXED, { id: "pt" })).toBe(undefined);
  });
});

describe("latexHtml (model-written tex)", () => {
  it("renders KaTeX markup for valid tex", () => {
    const html = latexHtml("\\frac{a}{b}");
    expect(html).toContain('class="katex"');
    expect(html).not.toContain("katex-error");
  });

  it("tex that KaTeX can't parse: the renderer shows it as an error, never throws (throwOnError: false)", () => {
    const html = latexHtml("\\frac{1}{");
    expect(html).toContain('class="katex-error"');
    expect(html).toContain("\\frac{1}{");
  });

  it("trust is off: \\href, \\url and \\htmlClass make no link or attribute", () => {
    for (const tex of [
      "\\href{javascript:alert(1)}{x}",
      "\\url{https://example.com}",
      "\\htmlClass{evil}{x}",
    ]) {
      const html = latexHtml(tex);
      expect(html).not.toMatch(/<a[\s>]/);
      expect(html).not.toContain("href=");
      expect(html).not.toContain('class="evil');
    }
  });

  it("HTML in tex is escaped, never markup", () => {
    const html = latexHtml('<img src=x onerror="alert(1)"><script>x</script>');
    expect(html).not.toMatch(/<img|<script/);
  });

  it("sizes are capped (maxSize) and macro loops stop (maxExpand)", () => {
    expect(latexHtml("\\rule{1000em}{1000em}")).toContain('width="10em"');
    expect(latexHtml("\\def\\a{\\a}\\a")).toContain("katex-error");
  });

  it("the validator rejects what the renderer shows as an error", () => {
    const step = {
      title: "t",
      narration: "n",
      objects: [
        { kind: "latex", id: "x", x: 10, y: 10, tex: "\\def\\a{\\a}\\a" },
      ],
      actions: [],
    };
    expect(validateStep(step, { maxNarrationChars: 100 })).toEqual({
      ok: false,
      errors: [errors.invalidLatex("x")],
    });
  });
});

describe("Whiteboard: latex and arrows", () => {
  const html = renderToStaticMarkup(<Whiteboard state={FIXED} />);

  it("renders a latex object as KaTeX, centred on its x,y", () => {
    expect(html).toMatch(
      /data-object-id="eq" data-kind="latex"[^>]*data-highlight="accent"[^>]*data-cx="330" data-cy="520"/,
    );
    expect(html).toContain('class="katex"');
  });

  it("an arrow end naming a moved part is that part's copy", () => {
    expect(html).toMatch(
      /data-object-id="to_copy" data-kind="arrow"[^>]*data-from-x="330" data-from-y="520" data-to-x="900" data-to-y="560"/,
    );
  });

  it("an arrow follows an object that moves", () => {
    // f moves (300, 300) -> (300, 150) from 1000 ms over 1000 ms.
    const at = (t: number) =>
      renderToStaticMarkup(<Whiteboard state={sceneState("arrows", t)} />);
    expect(at(0)).toMatch(/data-object-id="fa"[^>]*data-from-y="300"/);
    expect(at(1500)).toMatch(/data-object-id="fa"[^>]*data-from-y="225"/);
    expect(at(2000)).toMatch(/data-object-id="fa"[^>]*data-from-y="150"/);
  });
});
