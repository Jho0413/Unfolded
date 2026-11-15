// The whiteboard renderer on /dev/board (ROADMAP P3, P7). Asserts on data-*
// attributes, never pixels, and checks timing by loading a time (?t=ms), never
// by waiting. demo-m1 cue times are in app/dev/board/scenes.ts.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";

const EVIDENCE = path.join(process.cwd(), "evidence", "103");

function object(page: Page, id: string): Locator {
  return page.locator(`[data-object-id="${id}"]`);
}

function cell(scope: Locator, r: number, c: number): Locator {
  return scope.locator(`[data-cell="${r},${c}"]`);
}

function copy(page: Page, key: string): Locator {
  return page.locator(`[data-copy-of="${key}"]`);
}

async function numberAttr(loc: Locator, name: string): Promise<number> {
  return Number(await loc.getAttribute(name));
}

test.describe("fixed BoardState", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dev/board");
    await expect(page.getByTestId("whiteboard")).toBeVisible();
  });

  test("is marked dev only", async ({ page }) => {
    await expect(page.getByRole("note")).toContainText("Dev only");
  });

  test("matrix: values, label and cells", async ({ page }) => {
    const m = object(page, "m");
    await expect(m).toHaveAttribute("data-kind", "matrix");
    await expect(m).toHaveAttribute("data-visible", "true");
    await expect(m.locator("[data-cell]")).toHaveCount(9);
    await expect(cell(m, 1, 1)).toHaveAttribute("data-value", "5");
    await expect(cell(m, 2, 2)).toHaveText("9");
    await expect(m.locator("[data-label]")).toHaveText("M");
  });

  test("matrix: row, column and cell highlights in both colours", async ({
    page,
  }) => {
    const m = object(page, "m");
    for (const c of [0, 1, 2])
      await expect(cell(m, 0, c)).toHaveAttribute("data-highlight", "accent");
    await expect(cell(m, 1, 2)).toHaveAttribute("data-highlight", "warn");
    await expect(cell(m, 2, 2)).toHaveAttribute("data-highlight", "warn");
    await expect(cell(m, 2, 0)).toHaveAttribute("data-highlight", "warn");
    await expect(cell(m, 1, 0)).toHaveAttribute("data-highlight", "none");
    await expect(cell(m, 1, 1)).toHaveAttribute("data-highlight", "none");
  });

  test("matrix: whole-matrix highlight", async ({ page }) => {
    const v = object(page, "v");
    await expect(cell(v, 0, 0)).toHaveAttribute("data-highlight", "accent");
    await expect(cell(v, 1, 0)).toHaveAttribute("data-highlight", "accent");
  });

  test("text: sizes and highlights", async ({ page }) => {
    await expect(object(page, "title")).toHaveAttribute("data-kind", "text");
    await expect(object(page, "title")).toHaveText("Fixed board");
    await expect(object(page, "small")).toHaveAttribute("data-size", "s");
    await expect(object(page, "medium")).toHaveAttribute("data-size", "m");
    await expect(object(page, "large")).toHaveAttribute("data-size", "l");
    await expect(object(page, "small")).toHaveAttribute(
      "data-highlight",
      "none",
    );
    await expect(object(page, "medium")).toHaveAttribute(
      "data-highlight",
      "accent",
    );
    await expect(object(page, "large")).toHaveAttribute(
      "data-highlight",
      "warn",
    );
  });

  test("hidden object is not drawn", async ({ page }) => {
    const gone = object(page, "gone");
    await expect(gone).toHaveAttribute("data-visible", "false");
    await expect(gone).toBeHidden();
  });

  test("hide and show in progress fade by progress", async ({ page }) => {
    await expect(object(page, "fading")).toHaveAttribute("data-opacity", "0.5");
    await expect(object(page, "appearing")).toHaveAttribute(
      "data-opacity",
      "0.25",
    );
    await expect(object(page, "title")).toHaveAttribute("data-opacity", "1");
  });

  test("copy of a row carries its source values and highlight", async ({
    page,
  }) => {
    const row = copy(page, "m:r1");
    await expect(row).toBeVisible();
    await expect(row.locator("[data-cell]")).toHaveCount(3);
    await expect(cell(row, 1, 0)).toHaveAttribute("data-value", "4");
    await expect(cell(row, 1, 2)).toHaveAttribute("data-value", "6");
    await expect(cell(row, 1, 0)).toHaveAttribute("data-highlight", "none");
    await expect(cell(row, 1, 2)).toHaveAttribute("data-highlight", "warn");
    expect(await numberAttr(row, "data-cx")).toBe(900);
    expect(await numberAttr(row, "data-cy")).toBe(560);
  });

  test("copy of a single cell carries its value and highlight", async ({
    page,
  }) => {
    const one = copy(page, "m:r2c0");
    await expect(one).toBeVisible();
    await expect(one.locator("[data-cell]")).toHaveCount(1);
    await expect(cell(one, 2, 0)).toHaveAttribute("data-value", "7");
    await expect(cell(one, 2, 0)).toHaveAttribute("data-highlight", "warn");
    expect(await numberAttr(one, "data-cx")).toBe(1150);
    expect(await numberAttr(one, "data-cy")).toBe(560);
  });

  test("latex: KaTeX formula centred on its x,y, with a highlight", async ({
    page,
  }) => {
    const eq = object(page, "eq");
    await expect(eq).toHaveAttribute("data-kind", "latex");
    await expect(eq).toHaveAttribute("data-visible", "true");
    await expect(eq).toHaveAttribute("data-highlight", "accent");
    await expect(eq.locator("[data-latex-highlight]")).toBeVisible();
    const formula = eq.locator(".katex-html");
    await expect(formula).toBeVisible();
    await expect(eq.locator(".katex-error")).toHaveCount(0);
    // The one layout check in this file: KaTeX's size is only known after
    // layout, so data-cx can't show the formula is centred. The laid-out
    // formula's centre is (330, 520) on the 1600 x 900 canvas, to ~5 px.
    const board = await page.getByTestId("whiteboard").boundingBox();
    const box = await formula.boundingBox();
    const scale = board!.width / 1600;
    expect(box!.x + box!.width / 2).toBeCloseTo(board!.x + 330 * scale, -1);
    expect(box!.y + box!.height / 2).toBeCloseTo(board!.y + 520 * scale, -1);
  });

  test("tex that KaTeX can't parse: shown as an error, the board still draws", async ({
    page,
  }) => {
    const bad = object(page, "bad");
    await expect(bad.locator(".katex-error")).toHaveText("\\frac{1}{");
    await expect(object(page, "eq").locator(".katex-html")).toBeVisible();
  });

  test("latex with trust off: \\href makes no link", async ({ page }) => {
    const unsafe = object(page, "unsafe");
    await expect(unsafe.locator(".katex")).toBeVisible();
    await expect(unsafe.locator("a")).toHaveCount(0);
    await expect(page.locator("[href^='javascript']")).toHaveCount(0);
  });

  test("arrow: an end naming a moved part points at its copy", async ({
    page,
  }) => {
    const arrow = object(page, "to_copy");
    await expect(arrow).toHaveAttribute("data-kind", "arrow");
    await expect(arrow).toHaveAttribute("data-label-text", "copy");
    await expect(arrow.locator("line")).toHaveCount(1);
    await expect(arrow.locator("polygon")).toHaveCount(1);
    await expect(arrow).toContainText("copy");
    expect(await numberAttr(arrow, "data-from-x")).toBe(330);
    expect(await numberAttr(arrow, "data-from-y")).toBe(520);
    expect(await numberAttr(arrow, "data-to-x")).toBe(900);
    expect(await numberAttr(arrow, "data-to-y")).toBe(560);
  });

  test("arrow: point ends, highlighted", async ({ page }) => {
    const arrow = object(page, "pt");
    await expect(arrow).toHaveAttribute("data-highlight", "warn");
    await expect(arrow).toHaveAttribute("data-highlight-opacity", "1");
    expect(await numberAttr(arrow, "data-from-x")).toBe(1200);
    expect(await numberAttr(arrow, "data-to-y")).toBe(760);
    // The base line plus its highlight overlay.
    await expect(arrow.locator("line")).toHaveCount(2);
  });
});

test.describe("arrows through sceneAt", () => {
  const at = (page: Page, t: number) =>
    page.goto(`/dev/board?scene=arrows&t=${t}`);

  test("an arrow follows an object that moves", async ({ page }) => {
    // f moves (300, 300) -> (300, 150) from 1000 ms over 1000 ms.
    await at(page, 0);
    const fa = object(page, "fa");
    expect(await numberAttr(fa, "data-from-y")).toBe(300);
    expect(await numberAttr(fa, "data-to-x")).toBe(1300);

    await at(page, 1500);
    expect(await numberAttr(object(page, "f"), "data-cy")).toBeCloseTo(225);
    expect(await numberAttr(object(page, "fa"), "data-from-y")).toBeCloseTo(
      225,
    );

    await at(page, 2000);
    expect(await numberAttr(object(page, "fa"), "data-from-y")).toBe(150);
  });

  test("an arrow from a matrix row follows the row's sliding copy", async ({
    page,
  }) => {
    // q row 0 centre (264, 624) -> (1000, 600) from 2000 ms over 1000 ms.
    await at(page, 1900);
    const before = object(page, "qa");
    expect(await numberAttr(before, "data-from-x")).toBe(264);
    expect(await numberAttr(before, "data-from-y")).toBe(624);

    await at(page, 2500);
    await expect(copy(page, "q:r0")).toBeVisible();
    const qa = object(page, "qa");
    expect(await numberAttr(qa, "data-from-x")).toBeCloseTo(632);
    expect(await numberAttr(qa, "data-from-y")).toBeCloseTo(612);
    // The point end doesn't move.
    expect(await numberAttr(qa, "data-to-x")).toBe(900);
    // No label, so no text.
    await expect(qa.locator("text")).toHaveCount(0);
  });

  test("latex and arrow: hidden until a show, then fade in with progress", async ({
    page,
  }) => {
    await at(page, 2900);
    for (const id of ["g", "ga"]) {
      await expect(object(page, id)).toHaveAttribute("data-visible", "false");
      await expect(object(page, id)).toBeHidden();
    }
    // show at 3000, 400 ms.
    await at(page, 3200);
    for (const id of ["g", "ga"]) {
      await expect(object(page, id)).toHaveAttribute("data-visible", "true");
      await expect(object(page, id)).toHaveAttribute("data-opacity", "0.5");
    }
    await at(page, 3400);
    await expect(object(page, "ga")).toHaveAttribute("data-opacity", "1");
  });

  test("arrow and latex highlights fade in with progress", async ({ page }) => {
    // highlight at 3500, 400 ms.
    await at(page, 3700);
    const fa = object(page, "fa");
    await expect(fa).toHaveAttribute("data-highlight", "warn");
    await expect(fa).toHaveAttribute("data-highlight-opacity", "0.5");
    const g = object(page, "g");
    await expect(g).toHaveAttribute("data-highlight", "accent");
    await expect(g).toHaveAttribute("data-highlight-opacity", "0.5");
    await at(page, 4000);
    await expect(object(page, "fa")).toHaveAttribute(
      "data-highlight-opacity",
      "1",
    );
  });
});

test.describe("demo-m1 through sceneAt", () => {
  const at = (page: Page, t: number, scene = "m1") =>
    page.goto(`/dev/board?scene=${scene}&t=${t}`);

  test("before any cue: no highlights, hidden texts not drawn", async ({
    page,
  }) => {
    await at(page, 0);
    await expect(cell(object(page, "a"), 0, 0)).toHaveAttribute(
      "data-highlight",
      "none",
    );
    await expect(object(page, "p1")).toHaveAttribute("data-visible", "false");
    await expect(object(page, "sum")).toBeHidden();
    await expect(page.locator("[data-copy-of]")).toHaveCount(0);
  });

  test("row and column highlights at their cues", async ({ page }) => {
    await at(page, 2050);
    const a = object(page, "a");
    const b = object(page, "b");
    await expect(cell(a, 0, 0)).toHaveAttribute("data-highlight", "accent");
    await expect(cell(a, 0, 1)).toHaveAttribute("data-highlight", "accent");
    await expect(cell(a, 1, 0)).toHaveAttribute("data-highlight", "none");
    await expect(cell(b, 0, 0)).toHaveAttribute("data-highlight", "accent");
    await expect(cell(b, 1, 0)).toHaveAttribute("data-highlight", "accent");
    await expect(cell(b, 0, 1)).toHaveAttribute("data-highlight", "none");
  });

  test("a highlight in progress fades in with its progress", async ({
    page,
  }) => {
    // col at 2000, 300 ms: halfway at 2150. row (1000) is complete.
    await at(page, 2150);
    const b = object(page, "b");
    await expect(cell(b, 0, 0)).toHaveAttribute(
      "data-highlight-opacity",
      "0.5",
    );
    await expect(cell(b, 0, 1)).toHaveAttribute("data-highlight-opacity", "0");
    await expect(cell(object(page, "a"), 0, 0)).toHaveAttribute(
      "data-highlight-opacity",
      "1",
    );
  });

  test("move: copies slide, interpolated from progress", async ({ page }) => {
    // slide starts at 3000 and lasts 800 ms: halfway at 3400.
    await at(page, 3400);
    const row = copy(page, "a:r0");
    const col = copy(page, "b:c0");
    // a row 0 centre (224, 184) -> (850, 184); b col 0 (472, 208) -> (1000, 208).
    expect(await numberAttr(row, "data-cx")).toBeCloseTo(537);
    expect(await numberAttr(row, "data-cy")).toBeCloseTo(184);
    expect(await numberAttr(col, "data-cx")).toBeCloseTo(736);
    // The source matrix stays whole.
    await expect(object(page, "a").locator("[data-cell]")).toHaveCount(4);
  });

  test("copies keep the source highlight after the slide", async ({ page }) => {
    await at(page, 4000);
    const row = copy(page, "a:r0");
    const col = copy(page, "b:c0");
    expect(await numberAttr(row, "data-cx")).toBe(850);
    await expect(cell(row, 0, 0)).toHaveAttribute("data-value", "1");
    await expect(cell(row, 0, 1)).toHaveAttribute("data-value", "2");
    await expect(cell(row, 0, 0)).toHaveAttribute("data-highlight", "accent");
    await expect(cell(row, 0, 1)).toHaveAttribute("data-highlight", "accent");
    await expect(cell(col, 0, 0)).toHaveAttribute("data-value", "5");
    await expect(cell(col, 1, 0)).toHaveAttribute("data-value", "7");
    await expect(cell(col, 1, 0)).toHaveAttribute("data-highlight", "accent");
  });

  test("a later highlight shows on the copy's cells", async ({ page }) => {
    // warn on a(0, 1) at 4000, after the row has moved.
    await at(page, 4400, "m1-late-highlight");
    const row = copy(page, "a:r0");
    await expect(cell(row, 0, 1)).toHaveAttribute("data-highlight", "warn");
    await expect(cell(row, 0, 0)).toHaveAttribute("data-highlight", "accent");
    await expect(cell(object(page, "a"), 0, 1)).toHaveAttribute(
      "data-highlight",
      "warn",
    );
  });

  test("show fades in with progress", async ({ page }) => {
    // pair1 at 4500, 300 ms.
    await at(page, 4650);
    await expect(object(page, "p1")).toHaveAttribute("data-visible", "true");
    await expect(object(page, "p1")).toHaveAttribute("data-opacity", "0.5");
    await expect(object(page, "p2")).toHaveAttribute("data-visible", "false");
  });

  test("write replaces a text's text", async ({ page }) => {
    await at(page, 5900);
    await expect(object(page, "sum")).toHaveAttribute("data-text", "1·5 + 2·7");
    // total at 6000, 300 ms: the new text fades in with progress.
    await at(page, 6150);
    await expect(object(page, "sum")).toHaveAttribute("data-text", "19");
    await expect(object(page, "sum")).toHaveAttribute(
      "data-value-opacity",
      "0.5",
    );
    await at(page, 6400);
    await expect(object(page, "sum")).toHaveAttribute("data-text", "19");
    await expect(object(page, "sum")).toHaveAttribute(
      "data-value-opacity",
      "1",
    );
  });

  test("move: a whole object slides to a cell", async ({ page }) => {
    // drop at 6500, 600 ms: sum (925, 420) -> c(0, 0) centre (1232, 184).
    await at(page, 6800);
    const sum = object(page, "sum");
    expect(await numberAttr(sum, "data-cx")).toBeCloseTo(1078.5);
    expect(await numberAttr(sum, "data-cy")).toBeCloseTo(302);
  });

  test("done: written cell, copies fade out, then leave", async ({ page }) => {
    // done at 7500: write c(0, 0), hide sum (0 ms), hide copies (300 ms).
    await at(page, 7650);
    const c = object(page, "c");
    await expect(cell(c, 0, 0)).toHaveAttribute("data-value", "19");
    await expect(cell(c, 0, 1)).toHaveAttribute("data-value", "");
    await expect(object(page, "sum")).toHaveAttribute("data-visible", "false");
    await expect(copy(page, "a:r0")).toHaveAttribute("data-opacity", "0.5");
    await expect(copy(page, "b:c0")).toHaveAttribute("data-opacity", "0.5");

    await at(page, 8000);
    await expect(cell(object(page, "c"), 0, 0)).toHaveText("19");
    await expect(page.locator("[data-copy-of]")).toHaveCount(0);
  });
});

test.describe("draw-on and reduced motion (issue #101)", () => {
  // The arrows scene shows the arrow ga at 3000 ms over 400 ms: 3100 is a quarter in.
  const line = (page: Page) => object(page, "ga").locator("line").first();
  const computed = (loc: Locator, prop: string) =>
    loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

  test("a quarter into its show, the arrow is drawn part way, from the clock", async ({
    page,
  }) => {
    await page.goto("/dev/board?scene=arrows&t=3100");
    await expect(object(page, "ga")).toHaveAttribute("data-draw", "0.58");
    expect(
      Number(await line(page).getAttribute("stroke-dashoffset")),
    ).toBeCloseTo(0.421875);
    expect(await computed(line(page), "stroke-dasharray")).not.toBe("none");
    // Drawn in full once the show ends.
    await page.goto("/dev/board?scene=arrows&t=3400");
    await expect(object(page, "ga")).toHaveAttribute("data-draw", "1");
    expect(await line(page).getAttribute("stroke-dashoffset")).toBeNull();
  });

  test("prefers-reduced-motion: no draw-on, and a quick fade (opaque a quarter in)", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/dev/board?scene=arrows&t=3100");
    expect(await computed(line(page), "stroke-dasharray")).toBe("none");
    expect(await computed(line(page), "stroke-dashoffset")).toBe("0px");
    expect(await computed(object(page, "ga"), "opacity")).toBe("1");
    // Without the preference, the same frame is still fading and drawing.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect(await computed(line(page), "stroke-dasharray")).not.toBe("none");
  });
});

// Heatmap and plot (issue #103): app/dev/board/vizStep.ts, cue times VIZ_CUE_TIMES.
test.describe("heatmap and plot through sceneAt", () => {
  const at = (page: Page, t: number) =>
    page.goto(`/dev/board?scene=viz&t=${t}`);
  const series = (page: Page, s: number) =>
    object(page, "soft").locator(`[data-series="${s}"]`);

  test("before any cue: heatmap cells blank, both series undrawn", async ({
    page,
  }) => {
    await at(page, 0);
    const attn = object(page, "attn");
    await expect(attn).toHaveAttribute("data-kind", "heatmap");
    await expect(attn.locator("[data-cell]")).toHaveCount(36);
    await expect(attn.locator('[data-revealed="true"]')).toHaveCount(0);
    await expect(attn.locator("[data-row-label]")).toHaveCount(6);
    await expect(object(page, "soft")).toHaveAttribute("data-kind", "plot");
    await expect(series(page, 0)).toHaveAttribute("data-drawn", "false");
    await expect(series(page, 1)).toHaveAttribute("data-drawn", "false");
  });

  test("row0 at 500, 600 ms: row 0 fades in with progress", async ({
    page,
  }) => {
    await at(page, 800);
    const attn = object(page, "attn");
    await expect(cell(attn, 0, 0)).toHaveAttribute("data-revealed", "true");
    await expect(cell(attn, 0, 0)).toHaveAttribute(
      "data-reveal-opacity",
      "0.5",
    );
    await expect(cell(attn, 0, 0)).toHaveAttribute("data-value", "0.7");
    await expect(cell(attn, 1, 0)).toHaveAttribute("data-revealed", "false");
  });

  test("peak at 3500: every row revealed, the cell it attends to highlighted warn", async ({
    page,
  }) => {
    await at(page, 4000);
    const attn = object(page, "attn");
    await expect(attn.locator('[data-revealed="true"]')).toHaveCount(36);
    await expect(cell(attn, 4, 1)).toHaveAttribute("data-highlight", "warn");
    await expect(cell(attn, 4, 1)).toHaveAttribute(
      "data-highlight-opacity",
      "1",
    );
  });

  test("curve at 4500, 1500 ms: series 0 draws on along x", async ({
    page,
  }) => {
    await at(page, 5250);
    await expect(series(page, 0)).toHaveAttribute("data-drawn", "true");
    await expect(series(page, 0)).toHaveAttribute("data-draw-progress", "0.5");
    // The pen is eased (motion.ts): halfway in time it is at z = 4.5, past 22 of 25 points.
    await expect(series(page, 0)).toHaveAttribute("data-drawn-points", "22");
    await expect(series(page, 1)).toHaveAttribute("data-drawn", "false");
    await at(page, 6000);
    await expect(series(page, 0)).toHaveAttribute("data-draw-progress", "1");
    await expect(series(page, 0)).toHaveAttribute("data-drawn-points", "25");
  });

  test("point at 8500: the point at z = 0 is ringed, and seeking back undoes it", async ({
    page,
  }) => {
    await at(page, 9000);
    await expect(series(page, 1)).toHaveAttribute("data-draw-progress", "1");
    await expect(
      object(page, "soft").locator('[data-point="0,12"]'),
    ).toHaveAttribute("data-highlight", "accent");
    await at(page, 5250);
    await expect(object(page, "soft").locator("[data-point]")).toHaveCount(0);
    await expect(series(page, 0)).toHaveAttribute("data-draw-progress", "0.5");
  });

  for (const theme of ["dark", "light"] as const)
    test(`renders in the ${theme} theme (evidence)`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      for (const [name, t] of [
        ["reveal", 1800],
        ["draw-on", 5250],
        ["end", 9000],
      ] as const) {
        await at(page, t);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await mkdir(EVIDENCE, { recursive: true });
        await page.getByTestId("whiteboard").screenshot({
          path: path.join(EVIDENCE, `viz-${name}-${theme}.png`),
        });
      }
    });
});
