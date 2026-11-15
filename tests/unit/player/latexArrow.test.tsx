// The latex and arrow primitives (ROADMAP P7). The browser checks are in
// tests/e2e/board.spec.ts; these cover the pure helpers: arrow geometry, and
// how model-written tex becomes HTML (KaTeX, with trust off).
import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FIXED, sceneState } from "@/app/dev/board/scenes";
import { Whiteboard } from "@/player/Whiteboard";
import { renderLatex } from "@/player/primitives/katex";
import { arrowGeometry, targetBox } from "@/player/primitives/arrowGeometry";
import {
  estimateSize,
  latexSize,
  MATRIX_FRAME,
  TEXT_SIZE,
  textBox,
} from "@/shared/boxes";
import { ARROW, LATEX_ERROR } from "@/player/primitives/style";
import {
  type Anchor,
  type BoardState,
  CELL,
  type ObjectState,
} from "@/shared/scene";
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

  it("a box reaching further up (a matrix's label): only an arrow end on its top side stops above it", () => {
    const labelled = { ...box, above: 30 };
    // Coming down into it: stops above the label (half height 10 + 30).
    const down = arrowGeometry(
      { x: 0, y: 0 },
      { x: 0, y: 200 },
      box,
      labelled,
    )!;
    expect(down.head.startsWith(`0,${200 - 40 - ARROW.margin} `)).toBe(true);
    // Leaving it upwards: starts above the label.
    const up = arrowGeometry({ x: 0, y: 200 }, { x: 0, y: 0 }, labelled)!;
    expect(up.y1).toBe(200 - 40 - ARROW.margin);
    // From the side or below: the label changes nothing.
    const side = arrowGeometry(
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      box,
      labelled,
    )!;
    expect(side.head.startsWith(`${200 - 20 - ARROW.margin},0 `)).toBe(true);
    const below = arrowGeometry({ x: 0, y: 0 }, { x: 0, y: 200 }, labelled)!;
    expect(below.y1).toBe(10 + ARROW.margin);
  });

  it("an arrow with room for ARROW.minLength: its ends stay outside both boxes", () => {
    // 100 long, 2 x 30 of insets: 40 left, more than minLength.
    const g = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, box, box)!;
    expect(g.x1).toBe(30);
    expect(g.head.startsWith("70,0 ")).toBe(true);
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
    expect(h.label).toEqual({ x: 50, y: -ARROW.labelGap });
    const v = arrowGeometry({ x: 0, y: 0 }, { x: 0, y: 100 })!;
    expect(v.label.x).toBeCloseTo(-ARROW.labelGap);
    expect(v.label.y).toBeCloseTo(50);
  });

  it("the label's box clears the line: half its height above a horizontal line, half its width beside a vertical one", () => {
    const label = { w: 80, h: 30 };
    const right = { x: 100, y: 0 };
    const down = { x: 0, y: 100 };
    const h = arrowGeometry(
      { x: 0, y: 0 },
      right,
      undefined,
      undefined,
      label,
    )!;
    expect(h.label.y).toBeCloseTo(-(ARROW.labelGap + 15));
    const v = arrowGeometry({ x: 0, y: 0 }, down, undefined, undefined, label)!;
    expect(v.label.x).toBeCloseTo(-(ARROW.labelGap + 40));
  });

  it("property: start, head base and tip run in order along from -> to, insets leave ARROW.minLength (or half), the label is above the line and its box clears it", () => {
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
        fc.tuple(coord, coord, coord, coord),
        fc.tuple(size, size, size),
        ([a, b, c, d], [fromBox, toBox, labelBox]) => {
          const len = Math.hypot(c - a, d - b);
          const g = arrowGeometry(
            { x: a, y: b },
            { x: c, y: d },
            fromBox,
            toBox,
            labelBox,
          );
          if (len < eps) return g === undefined;
          if (!g) return false;
          const [tx, ty] = g.head.split(" ")[0].split(",").map(Number);
          const along = (x: number, y: number) => Math.hypot(x - a, y - b);
          const start = along(g.x1, g.y1);
          const base = along(g.x2, g.y2);
          const tip = along(tx, ty);
          const midY = (g.y1 + ty) / 2;
          // The label's distance from the line, against its box's half extent across it.
          const nx = -(d - b) / len;
          const ny = (c - a) / len;
          const across = labelBox
            ? (Math.abs(nx) * labelBox.w + Math.abs(ny) * labelBox.h) / 2
            : 0;
          const distance = Math.abs(
            (g.label.x - a) * nx + (g.label.y - b) * ny,
          );
          return (
            start <= base + eps &&
            base <= tip + eps &&
            tip <= len + eps &&
            start + (len - tip) <=
              Math.max(len / 2, len - ARROW.minLength) + eps &&
            g.label.y <= midY + eps &&
            distance >= across + ARROW.labelGap - 1e-6
          );
        },
      ),
    );
  });
});

describe("estimateSize", () => {
  it("a taller formula is taller, a longer one wider", () => {
    const one = renderLatex("x").size;
    const frac = renderLatex("\\frac{a}{b}").size;
    const long = renderLatex("x + y + z + w").size;
    expect(frac.h).toBeGreaterThan(one.h);
    expect(long.w).toBeGreaterThan(one.w);
  });
  it("counts only the visible formula, not the MathML copy", () => {
    expect(estimateSize(renderLatex("ab").html!).w).toBeLessThan(
      estimateSize(renderLatex("abcd").html!).w,
    );
    expect(estimateSize("plain")).toEqual(estimateSize("plaix"));
  });
});

describe("latexSize: a matrix is as wide as its widest row, not all its cells", () => {
  const bmatrix = (rows: string[][]) =>
    `\\begin{bmatrix}${rows.map((r) => r.join("&")).join("\\\\")}\\end{bmatrix}`;

  it("more rows of the same cells: as wide", () => {
    const row = [["1", "22", "3"]];
    const three = [row[0], ["4", "5", "6"], ["7", "8", "9"]];
    expect(latexSize(bmatrix(three)).w).toBe(latexSize(bmatrix(row)).w);
    expect(latexSize(bmatrix(three)).h).toBeGreaterThan(
      latexSize(bmatrix(row)).h,
    );
  });

  it("a 4 x 3 matrix is far narrower than counting every cell", () => {
    const tex = bmatrix([
      ["10", "20", "30"],
      ["40", "50", "60"],
      ["70", "80", "90"],
      ["11", "12", "13"],
    ]);
    const counted = estimateSize(renderLatex(tex).html!).w;
    expect(latexSize(tex).w).toBeLessThan(counted * 0.7);
  });

  it("a wider cell widens its column, and text beside the matrix counts too", () => {
    const narrow = latexSize(bmatrix([["1", "2"]])).w;
    expect(latexSize(bmatrix([["1000", "2"]])).w).toBeGreaterThan(narrow);
    expect(latexSize(`A=${bmatrix([["1", "2"]])}`).w).toBeGreaterThan(narrow);
  });

  it("the board uses the same estimate (renderLatex's size)", () => {
    const tex = bmatrix([
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(renderLatex(tex).size).toEqual(latexSize(tex));
  });
});

describe("targetBox", () => {
  it("points have no box; matrices, their parts, texts, latex and images do", () => {
    expect(targetBox(FIXED, { x: 1, y: 1 })).toBe(undefined);
    expect(targetBox(FIXED, { id: "nope" })).toBe(undefined);
    // A whole matrix reaches up to its label's top too, so arrows stop above the label.
    const { bracketGap, labelLift, labelFont } = MATRIX_FRAME;
    expect(targetBox(FIXED, { id: "m" })).toEqual({
      w: 3 * CELL.w,
      h: 3 * CELL.h,
      above: bracketGap + labelLift + labelFont,
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
    expect(targetBox(FIXED, { id: "eq" })).toEqual(
      renderLatex("\\frac{QK^\\top}{\\sqrt{d_k}}").size,
    );
    expect(targetBox(FIXED, { id: "pt" })).toBe(undefined);
    const withImage: BoardState = {
      objects: [
        {
          object: {
            kind: "image",
            id: "img",
            x: 0,
            y: 0,
            w: 300,
            h: 200,
            prompt: "p",
          },
          visible: true,
          highlight: null,
        },
      ],
      copies: [],
      active: [],
    };
    expect(targetBox(withImage, { id: "img" })).toEqual({ w: 300, h: 200 });
  });
});

describe("renderLatex (model-written tex)", () => {
  it("renders KaTeX markup for valid tex", () => {
    const html = renderLatex("\\frac{a}{b}").html!;
    expect(html).toContain('class="katex"');
    expect(html).not.toContain("katex-error");
  });

  it("tex that KaTeX can't parse: the renderer shows it as an error, never throws (throwOnError: false)", () => {
    const html = renderLatex("\\frac{1}{").html!;
    expect(html).toContain('class="katex-error"');
    expect(html).toContain("\\frac{1}{");
  });

  it("trust is off: \\href, \\url and \\htmlClass make no link or attribute", () => {
    for (const tex of [
      "\\href{javascript:alert(1)}{x}",
      "\\url{https://example.com}",
      "\\htmlClass{evil}{x}",
    ]) {
      const html = renderLatex(tex).html!;
      expect(html).not.toMatch(/<a[\s>]/);
      expect(html).not.toContain("href=");
      expect(html).not.toContain('class="evil');
    }
  });

  it("HTML in tex is escaped, never markup", () => {
    const html = renderLatex(
      '<img src=x onerror="alert(1)"><script>x</script>',
    ).html!;
    expect(html).not.toMatch(/<img|<script/);
  });

  it("KaTeX failing outright (nesting that overflows the stack): no throw, the board shows the source as an error", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const tex = "{".repeat(20000) + "x" + "}".repeat(20000);
    expect(renderLatex(tex).html).toBe(undefined);
    expect(error).toHaveBeenCalledOnce();
    const state: BoardState = {
      objects: [
        {
          object: { kind: "latex", id: "deep", x: 800, y: 450, tex },
          visible: true,
          highlight: null,
        },
      ],
      copies: [],
      active: [],
    };
    const html = renderToStaticMarkup(<Whiteboard state={state} />);
    expect(html).toMatch(/class="katex-error"[^>]*>\{\{\{/);
  });

  it("sizes are capped (maxSize) and macro loops stop (maxExpand)", () => {
    expect(renderLatex("\\rule{1000em}{1000em}").html!).toContain(
      'width="10em"',
    );
    expect(renderLatex("\\def\\a{\\a}\\a").html!).toContain("katex-error");
  });

  it("property: tex the validator accepts renders with no error, and tex it rejects still renders, never throws (one KATEX_OPTIONS)", () => {
    const token = fc.constantFrom(
      ..."\\frac \\sqrt \\def \\a \\href \\url \\htmlClass \\includegraphics \\rule \\left( \\right) \\text x 1 em ^ _ { } ( ) & \\\\ \\undefinedcmd".split(
        " ",
      ),
      " ",
    );
    const tex = fc.array(token, { maxLength: 12 }).map((t) => t.join(""));
    fc.assert(
      fc.property(tex, (t) => {
        const step = {
          title: "t",
          narration: "n",
          objects: [{ kind: "latex", id: "x", x: 10, y: 10, tex: t }],
          actions: [],
        };
        const result = validateStep(step, { maxNarrationChars: 100 });
        const rejected =
          !result.ok && result.errors.includes(errors.invalidLatex("x"));
        // Rejected tex shows as KaTeX's error text or a red unknown or
        // refused command; accepted tex shows neither (no token sets a colour).
        const html = renderLatex(t).html!;
        return rejected
          ? html.includes('class="katex')
          : !html.includes("katex-error") && !html.includes(LATEX_ERROR);
      }),
    );
  });
});

describe("Whiteboard: latex and arrows", () => {
  const html = renderToStaticMarkup(<Whiteboard state={FIXED} />);

  it("renders a latex object as KaTeX, centred on its x,y", () => {
    expect(html).toMatch(
      /data-object-id="eq"[^>]*data-kind="latex"[^>]*data-highlight="accent"[^>]*data-cx="330"[^>]*data-cy="520"/,
    );
    expect(html).toContain('class="katex"');
  });

  it("an arrow end naming a moved part is that part's copy", () => {
    expect(html).toMatch(
      /data-object-id="to_copy"[^>]*data-kind="arrow"[^>]*data-from-x="330"[^>]*data-from-y="520"[^>]*data-to-x="900"[^>]*data-to-y="560"/,
    );
  });

  it("an arrow's drawn line stops outside its targets' boxes", () => {
    // eq (latex) -> the copy of m's row 1 (3 cells wide).
    const g = arrowGeometry(
      { x: 330, y: 520 },
      { x: 900, y: 560 },
      renderLatex("\\frac{QK^\\top}{\\sqrt{d_k}}").size,
      { w: 3 * CELL.w, h: CELL.h },
    )!;
    expect(html).toMatch(
      new RegExp(
        `data-object-id="to_copy"[^]*?<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}"`,
      ),
    );
  });

  it("an arrow with an unknown or coincident end draws nothing", () => {
    const arrow = (id: string, from: Anchor, to: Anchor): ObjectState => ({
      object: { kind: "arrow", id, from, to },
      visible: true,
      highlight: null,
    });
    const state: BoardState = {
      objects: [
        arrow("unknown", { id: "nope" }, { x: 10, y: 10 }),
        arrow("same", { x: 5, y: 5 }, { x: 5, y: 5 }),
      ],
      copies: [],
      active: [],
    };
    const out = renderToStaticMarkup(<Whiteboard state={state} />);
    expect(out).toContain('data-object-id="unknown"');
    expect(out).toContain('data-object-id="same"');
    expect(out).not.toMatch(/<line|<polygon|<text/);
    expect(out).not.toMatch(/data-object-id="unknown"[^>]*data-from-x/);
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
