// Zooming the board on a phone (player/zoom/useBoardZoom.ts, QA A10 follow-up): a tap on the
// board shows it about 2.2x the screen's width in a full-screen layer, panned by a real touch
// drag; the lesson holds on while it's open and goes on when it closes (X, Escape, or a tap
// outside the board). Escape with Ask open closes only the zoom. Desktop never zooms. At 390 px,
// light and dark; screenshots go to evidence/zoom/.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { savedRun } from "./support/savedRun";
import { askByKey } from "./support/tutor";

test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

const EVIDENCE = path.join(process.cwd(), "evidence", "zoom");
const player = (page: Page) => page.getByTestId("player");
const pane = (page: Page) => page.getByTestId("board-pane");
const drawing = (page: Page) => page.getByTestId("board-drawing");
const board = (page: Page) => drawing(page).getByTestId("whiteboard");

async function playing(page: Page, lessonId: string) {
  await page.goto(`/lesson/${lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
}

async function zoomByTap(page: Page) {
  const box = (await board(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
  await expect(pane(page)).toHaveAttribute("data-zoom", "1");
}

/** A one-finger drag, as touch events (start, moves, end) through the browser's input. */
async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const cdp = await page.context().newCDPSession(page);
  const at = (t: number) => [
    {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      id: 1,
    },
  ];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: at(0),
  });
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: at(i / 12),
    });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

/** The rendered height of a matrix cell's value: what the eye reads. */
const cellTextPx = (page: Page) =>
  board(page)
    .locator('[data-object-id="a"] [data-cell="0,0"] text')
    .evaluate((t) => t.getBoundingClientRect().height);

for (const theme of ["light", "dark"] as const)
  test.describe(`390 px, ${theme}`, () => {
    // A touch screen: the drag below is a real touch gesture.
    test.use({
      viewport: { width: 390, height: 844 },
      colorScheme: theme,
      hasTouch: true,
    });

    test("a tap zooms the board at least 2x and holds the lesson; a touch drag pans; X closes and the lesson goes on", async ({
      page,
    }) => {
      await using run = await savedRun(`e2e-zoom-${theme}`);
      await playing(page, run.lessonId);
      await expect(page.getByTestId("zoom-open")).toBeVisible();
      const before = (await board(page).boundingBox())!.width;
      const textBefore = await cellTextPx(page);

      await zoomByTap(page);
      await expect(player(page)).toHaveAttribute("data-state", "paused");
      const after = (await board(page).boundingBox())!.width;
      expect(after).toBeGreaterThanOrEqual(2 * before);
      expect(await cellTextPx(page)).toBeGreaterThanOrEqual(2 * textBefore);
      // The layer covers the screen, and the page itself still doesn't scroll sideways.
      const layer = (await drawing(page).boundingBox())!;
      expect(layer).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);

      // It pans: wider than the screen, and a real touch drag to the left moves it right.
      expect(
        await drawing(page).evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeGreaterThan(300);
      // Retried as a whole: a drag that lands before the layer settles can be dropped.
      await expect(async () => {
        await touchDrag(page, { x: 300, y: 420 }, { x: 60, y: 420 });
        expect(
          await drawing(page).evaluate((el) => el.scrollLeft),
        ).toBeGreaterThan(100);
      }).toPass({ timeout: 10_000 });
      await mkdir(EVIDENCE, { recursive: true });
      await page.screenshot({
        path: path.join(EVIDENCE, `zoomed-390-${theme}.png`),
      });

      await page.getByTestId("zoom-close").click();
      await expect(pane(page)).not.toHaveAttribute("data-zoom", "1");
      await expect(player(page)).toHaveAttribute("data-state", "playing");
      expect((await board(page).boundingBox())!.width).toBeCloseTo(before, 0);
    });
  });

test.describe("390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the zoom button opens it too; Escape closes it; a tap outside the board closes it", async ({
    page,
  }) => {
    await using run = await savedRun("e2e-zoom-close");
    await playing(page, run.lessonId);
    await page.getByTestId("zoom-open").click();
    await expect(pane(page)).toHaveAttribute("data-zoom", "1");
    await page.keyboard.press("Escape");
    await expect(pane(page)).not.toHaveAttribute("data-zoom", "1");
    await expect(player(page)).toHaveAttribute("data-state", "playing");

    await zoomByTap(page);
    // The layer's empty top margin, outside the board.
    await page.mouse.click(195, 20);
    await expect(pane(page)).not.toHaveAttribute("data-zoom", "1");
    await expect(player(page)).toHaveAttribute("data-state", "playing");
  });

  test("a lesson the learner held stays held after the zoom closes", async ({
    page,
  }) => {
    await using run = await savedRun("e2e-zoom-held");
    await playing(page, run.lessonId);
    await page.keyboard.press("Space");
    await expect(player(page)).toHaveAttribute("data-state", "paused");
    await zoomByTap(page);
    await page.getByTestId("zoom-close").click();
    await expect(pane(page)).not.toHaveAttribute("data-zoom", "1");
    await expect(player(page)).toHaveAttribute("data-state", "paused");
  });

  test("with Ask open, Escape closes the zoom, not Ask", async ({ page }) => {
    await using run = await savedRun("e2e-zoom-ask");
    await playing(page, run.lessonId);
    await askByKey(page);
    await expect(player(page)).toHaveAttribute("data-state", "asking");
    await page.getByTestId("zoom-open").click();
    await expect(pane(page)).toHaveAttribute("data-zoom", "1");
    await page.keyboard.press("Escape");
    await expect(pane(page)).not.toHaveAttribute("data-zoom", "1");
    await expect(player(page)).toHaveAttribute("data-state", "asking");
  });
});

test("desktop (1440 px): no zoom button, and a click on the board doesn't zoom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await using run = await savedRun("e2e-zoom-desktop");
  await playing(page, run.lessonId);
  await expect(page.getByTestId("zoom-open")).toHaveCount(0);
  const box = (await board(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
  await expect(pane(page)).not.toHaveAttribute("data-zoom", "1");
});
