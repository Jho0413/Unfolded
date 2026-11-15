// A "try it yourself" widget on a short desktop screen (#148, DEMO.md): the panel takes a share
// of the board's height (player/widget/Widget.module.css), so the lesson's drawing above it
// keeps a usable height, and the widget's controls scroll beside its drawing. At 1440x900,
// 1280x800 and 1920x1080, light and dark, with the paper beside the board (the narrow board);
// the phone's panel is phone.spec.ts's. Screenshots go to evidence/148/.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { FAKE_WIDGETS } from "@/app/dev/player/fakeWidgets";
import { Widget } from "@/shared/widget";
import { paperPdf } from "./support/paperPdf";
import { SAVED_AUDIO_MS, savedRun } from "./support/savedRun";

test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

const EVIDENCE = path.join(process.cwd(), "evidence", "148");

/** The largest heatmap a step can carry (8 x 8), with a temperature: the tallest controls. */
const NAMES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const BIG_HEATMAP = Widget.parse({
  kind: "heatmap",
  prompt: "Try it yourself: edit a score, or turn the temperature down.",
  values: NAMES.map((_, r) => NAMES.map((_, c) => (r === c ? 2 : 0.5))),
  rowLabels: NAMES,
  colLabels: NAMES,
  transform: "softmax-rows",
  temperature: { min: 0.1, max: 3, step: 0.1, value: 1 },
});

const WIDGETS = {
  plot: FAKE_WIDGETS.plot,
  heatmap: FAKE_WIDGETS.heatmap,
  "big-heatmap": BIG_HEATMAP,
} as const;

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
] as const;

const box = async (page: Page, testId: string) =>
  (await page.getByTestId(testId).boundingBox())!;

for (const viewport of VIEWPORTS)
  for (const theme of ["light", "dark"] as const)
    for (const [name, widget] of Object.entries(WIDGETS))
      test(`${viewport.width}x${viewport.height}, ${theme}, ${name}: the lesson's drawing keeps a usable height above the widget, whose controls stay in reach`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: theme });
        await using run = await savedRun(
          `e2e-wh-${viewport.width}-${theme}-${name}`,
          { widget },
        );
        await page.route(`**/api/runs/${run.lessonId}/paper.pdf`, (route) =>
          route.fulfill({ body: paperPdf(), contentType: "application/pdf" }),
        );
        await page.goto(`/lesson/${run.lessonId}`);
        await expect(page.getByTestId("paper")).toHaveAttribute(
          "data-pages",
          /\d+/,
        );
        await expect(page.getByTestId("player")).toHaveAttribute(
          "data-state",
          "playing",
        );
        await page.getByTestId("player-audio").evaluate(
          (a: HTMLAudioElement, s) => {
            a.currentTime = s;
          },
          (SAVED_AUDIO_MS - 100) / 1000,
        );
        await expect(page.getByTestId("player")).toHaveAttribute(
          "data-state",
          "stepEnded",
        );
        const panel = page.getByTestId("widget-panel");
        await expect(panel).toBeVisible();

        await expect(async () => {
          const board = await box(page, "board-pane");
          const drawing = (await page
            .getByTestId("board-pane")
            .locator("svg")
            .first()
            .boundingBox())!;
          const dock = (await page
            .getByTestId("tutor-card")
            .locator("..")
            .boundingBox())!;
          const widgetBox = await box(page, "widget-panel");
          // The panel is a share of the board's height, and the drawing keeps a usable one.
          expect(widgetBox.height).toBeLessThanOrEqual(board.height * 0.4 + 1);
          expect(drawing.height).toBeGreaterThanOrEqual(
            Math.max(150, board.height * 0.25),
          );
          // Clear of the dock.
          expect(drawing.y + drawing.height).toBeLessThanOrEqual(dock.y + 1);
        }).toPass({ timeout: 5_000 });

        // The widget's drawing is whole in the panel, and its last control is in reach:
        // scrolled to, with the drawing still in view beside it.
        const widgetDrawing = page.getByTestId("widget-drawing");
        await expect(widgetDrawing).toBeInViewport({ ratio: 1 });
        const last = panel.getByRole("slider").last();
        await last.scrollIntoViewIfNeeded();
        await expect(last).toBeInViewport({ ratio: 1 });
        await expect(widgetDrawing).toBeInViewport({ ratio: 0.9 });
        // It still works there.
        const output = panel.locator("output").last();
        const was = await output.textContent();
        await last.fill(await last.getAttribute("min").then((m) => m ?? "0"));
        await expect(output).not.toHaveText(was ?? "");
        // Nothing wider than the screen.
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(viewport.width);

        await mkdir(EVIDENCE, { recursive: true });
        await page.screenshot({
          path: path.join(EVIDENCE, `${viewport.width}-${theme}-${name}.png`),
        });
      });
