// QA A3 and A4 on the lesson page: a long value fits its matrix cell (measured with the
// browser's own text layout, not the estimate), and the board shows the part of the canvas
// the step uses, with every object inside it. Screenshots go to evidence/qa-a3a4/.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { CELL } from "@/shared/scene";
import { SAVED_AUDIO_MS, savedRun } from "./support/savedRun";

const EVIDENCE = path.join(process.cwd(), "evidence", "qa-a3a4");
const board = (page: Page) => page.getByTestId("whiteboard");
const player = (page: Page) => page.getByTestId("player");

test.use({
  viewport: { width: 1440, height: 900 },
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

async function atEnd(page: Page, lessonId: string) {
  await page.goto(`/lesson/${lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await page.getByTestId("player-audio").evaluate(
    (a: HTMLAudioElement, s) => {
      a.currentTime = s;
    },
    (SAVED_AUDIO_MS - 100) / 1000,
  );
  await expect(player(page)).toHaveAttribute("data-state", "stepEnded");
}

for (const theme of ["light", "dark"] as const)
  test(`${theme}: long values stay inside their cells (QA A3)`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await using run = await savedRun(`e2e-fit-${theme}`, {
      extraObjects: [
        {
          kind: "matrix",
          id: "probs",
          x: 160,
          y: 520,
          label: "softmax",
          rows: [
            ["0.9817", "0.0180", "0.0003"],
            ["BMW truck carrot", "0.9817 0.0180 0.0003", "1"],
          ],
        },
      ],
    });
    await atEnd(page, run.lessonId);
    const widths = await board(page)
      .locator('[data-object-id="probs"] [data-cell] text')
      .evaluateAll((els) =>
        els.map((el) => {
          const b = (el as SVGTextElement).getBBox();
          return { text: el.textContent, w: b.width, h: b.height };
        }),
      );
    expect(widths).toHaveLength(6);
    for (const { text, w, h } of widths) {
      expect(w, `"${text}" is ${w} wide`).toBeLessThanOrEqual(CELL.w);
      expect(h, `"${text}" is ${h} tall`).toBeLessThanOrEqual(CELL.h);
    }
    await mkdir(EVIDENCE, { recursive: true });
    await page.screenshot({
      path: path.join(EVIDENCE, `cells-1440-${theme}.png`),
    });
  });

test("the board is cropped to the step's drawing, with every object inside the view (QA A4)", async ({
  page,
}) => {
  await using run = await savedRun("e2e-crop");
  await atEnd(page, run.lessonId);
  const view = (await board(page).getAttribute("data-view"))!
    .split(" ")
    .map(Number);
  expect(view).not.toEqual([0, 0, 1600, 900]);
  const [vx, vy, vw, vh] = view;
  const boxes = await board(page)
    .locator('[data-object-id][data-visible="true"]')
    .evaluateAll((els) =>
      els.map((el) => {
        const b = (el as SVGGraphicsElement).getBBox();
        return {
          id: el.getAttribute("data-object-id"),
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
        };
      }),
    );
  expect(boxes.length).toBeGreaterThan(0);
  for (const b of boxes) {
    expect(b.x, b.id!).toBeGreaterThanOrEqual(vx);
    expect(b.y, b.id!).toBeGreaterThanOrEqual(vy);
    expect(b.x + b.width, b.id!).toBeLessThanOrEqual(vx + vw);
    expect(b.y + b.height, b.id!).toBeLessThanOrEqual(vy + vh);
  }
  await mkdir(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, "crop-1440-light.png") });
});
