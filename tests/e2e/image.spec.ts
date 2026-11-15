// Illustrations on the whiteboard (E1, issue #152), on /dev/board?scene=image at 1440 x 900,
// light and dark: a picture fades in on its cue, fitted inside its box in a rounded frame; an
// image without a `mediaUrl` isn't drawn, and a broken picture is hidden. Cue times are in
// app/dev/board/imageStep.ts. Screenshots go to evidence/e1/.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { IMAGE_CUE_TIMES as T } from "@/app/dev/board/imageStep";

const EVIDENCE = path.join(process.cwd(), "evidence", "e1");

const object = (page: Page, id: string): Locator =>
  page.locator(`[data-object-id="${id}"]`);

async function open(page: Page, t: number) {
  await page.goto(`/dev/board?scene=image&t=${t}`);
  await expect(page.getByTestId("whiteboard")).toBeVisible();
}

/** A rect's on-screen box, in board units (the board is scaled to fit the page). */
async function boardBox(page: Page, loc: Locator) {
  return loc.evaluate((el) => {
    const g = el as SVGGraphicsElement;
    const b = g.getBBox();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
}

test.use({ viewport: { width: 1440, height: 900 } });

for (const theme of ["light", "dark"] as const)
  test.describe(`${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
    });

    test("an illustration is hidden before its cue and fades in on it", async ({
      page,
    }) => {
      await open(page, 0);
      await expect(object(page, "wide")).toHaveAttribute(
        "data-visible",
        "false",
      );
      await expect(object(page, "wide")).toHaveAttribute(
        "visibility",
        "hidden",
      );

      await open(page, T.wide + 300);
      const wide = object(page, "wide");
      await expect(wide).toHaveAttribute("data-status", "ready");
      await expect(wide).toHaveAttribute("data-visible", "true");
      const opacity = Number(await wide.getAttribute("data-opacity"));
      expect(opacity).toBeGreaterThan(0);
      expect(opacity).toBeLessThan(1);
      // Not yet shown: the tall one.
      await expect(object(page, "tall")).toHaveAttribute(
        "data-visible",
        "false",
      );
    });

    test("pictures are fitted inside their boxes, keeping their aspect, in a frame", async ({
      page,
    }) => {
      await open(page, T.look + 1000);
      for (const [id, box, fit] of [
        // The 3:2 picture in an 800 x 400 box: fitted to its height, centred across.
        ["wide", [100, 150, 800, 400], [200, 150, 600, 400]],
        // In a 300 x 500 box: fitted to its width, centred down.
        ["tall", [1000, 150, 300, 500], [1000, 300, 300, 200]],
      ] as const) {
        const g = object(page, id);
        await expect(g).toHaveAttribute("data-status", "ready");
        await expect(g).toHaveAttribute("data-opacity", "1");
        await expect(g).toHaveAttribute("data-fit", fit.join(" "));
        const img = g.locator("image");
        await expect(img).toHaveCount(1);
        await expect(img).toHaveAttribute(
          "preserveAspectRatio",
          "xMidYMid meet",
        );
        const b = await boardBox(page, img);
        expect(b.x).toBeGreaterThanOrEqual(box[0]);
        expect(b.y).toBeGreaterThanOrEqual(box[1]);
        expect(b.x + b.w).toBeLessThanOrEqual(box[0] + box[2]);
        expect(b.y + b.h).toBeLessThanOrEqual(box[1] + box[3]);
        expect(b.w / b.h).toBeCloseTo(1.5, 2);
        // The picture really decoded (the browser drew it), and on screen it keeps 3:2.
        const shown = (await img.boundingBox())!;
        expect(shown.width / shown.height).toBeCloseTo(1.5, 1);
        // A rounded frame around it.
        const frame = g.locator("rect[stroke]").first();
        await expect(frame).toHaveAttribute("rx", "12");
      }
      // The whole-object highlight frames the wide one.
      await expect(object(page, "wide")).toHaveAttribute(
        "data-highlight",
        "accent",
      );
    });

    test("an image without a mediaUrl isn't drawn, and a broken picture is hidden", async ({
      page,
    }) => {
      await open(page, T.broken + 1000);
      await expect(object(page, "missing")).toHaveCount(0);
      const broken = object(page, "broken");
      await expect(broken).toHaveAttribute("data-status", "failed");
      await expect(broken).toHaveAttribute("visibility", "hidden");
      await expect(broken.locator("image")).toHaveCount(0);
      // The others are unaffected.
      await expect(object(page, "wide")).toHaveAttribute(
        "data-status",
        "ready",
      );
    });

    test("renders (evidence)", async ({ page }) => {
      await mkdir(EVIDENCE, { recursive: true });
      for (const [name, t] of [
        ["fading-in", T.wide + 300],
        ["highlight", T.look + 200],
        ["end", T.broken + 1000],
      ] as const) {
        await open(page, t);
        await expect(object(page, "wide")).toHaveAttribute(
          "data-status",
          "ready",
        );
        await expect(object(page, "tall")).not.toHaveAttribute(
          "data-status",
          "loading",
        );
        await page.screenshot({
          path: path.join(EVIDENCE, `1440-${theme}-${name}.png`),
        });
      }
    });
  });
