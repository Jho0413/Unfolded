// "Try it yourself" widgets (issue #110) on /dev/player?widget=plot|heatmap (step 1 ends with
// the widget, step 2 has none: app/dev/player/fakeLesson.ts), and on the lesson page for Ask.
// Each kind at desktop and phone width, in light and dark, with a real slider drag or cell
// edit; screenshots go to evidence/110/.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { FAKE_WIDGETS } from "@/app/dev/player/fakeWidgets";
import { FAKE_AUDIO_MS } from "@/app/dev/player/fakeLesson";
import { SAVED_AUDIO_MS, savedRun } from "./support/savedRun";
import { askByKey, card, nextIdea, sayAgain } from "./support/tutor";

test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

const EVIDENCE = path.join(process.cwd(), "evidence", "110");
const player = (page: Page) => page.getByTestId("player");
const panel = (page: Page) => page.getByTestId("widget-panel");
const drawing = (page: Page) => page.getByTestId("widget-drawing");
const audio = (page: Page) => page.getByTestId("player-audio");

async function seekToEnd(page: Page, audioMs: number) {
  await audio(page).evaluate(
    (a: HTMLAudioElement, s) => {
      a.currentTime = s;
    },
    (audioMs - 100) / 1000,
  );
  await expect(player(page)).toHaveAttribute("data-state", "stepEnded");
}

async function openEnded(page: Page, kind: "plot" | "heatmap") {
  await page.goto(`/dev/player?widget=${kind}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await expect(panel(page)).toHaveCount(0);
  await seekToEnd(page, FAKE_AUDIO_MS);
}

const clock = (page: Page) =>
  audio(page).evaluate((a: HTMLAudioElement) => a.currentTime);

/** Drags a range input's thumb to `share` (0..1) of its track with the mouse. */
async function drag(slider: Locator, share: number) {
  // On a phone the panel scrolls (Widget.module.css), so bring the slider into view first.
  await slider.scrollIntoViewIfNeeded();
  const box = (await slider.boundingBox())!;
  const page = slider.page();
  const value = Number(await slider.inputValue());
  const min = Number(await slider.getAttribute("min"));
  const max = Number(await slider.getAttribute("max"));
  const from = box.x + ((value - min) / (max - min)) * box.width;
  const y = box.y + box.height / 2;
  await page.mouse.move(from, y);
  await page.mouse.down();
  await page.mouse.move(box.x + share * box.width, y, { steps: 8 });
  await page.mouse.up();
}

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

for (const [vp, viewport] of Object.entries(VIEWPORTS))
  for (const theme of ["dark", "light"] as const)
    test.describe(`${vp}, ${theme}`, () => {
      test.use({ viewport, colorScheme: theme });

      test("plot widget: appears with its prompt at the end; a slider drag redraws the curve at once, clock untouched", async ({
        page,
      }) => {
        await openEnded(page, "plot");
        await expect(panel(page)).toBeVisible();
        await expect(panel(page)).toHaveAttribute("data-kind", "plot");
        await expect(card(page).getByTestId("widget-prompt")).toHaveText(
          FAKE_WIDGETS.plot.prompt,
        );
        const t0 = await clock(page);
        const firstY = await drawing(page).getAttribute("data-first-y");
        const height = panel(page).getByRole("slider", { name: "Height a" });
        await expect(height).toBeVisible();
        await drag(height, 0.95);
        await expect(panel(page).getByTestId("value-a")).not.toHaveText("1");
        await expect(drawing(page)).not.toHaveAttribute(
          "data-first-y",
          firstY!,
        );
        expect(await clock(page)).toBe(t0);
        await expect(player(page)).toHaveAttribute("data-state", "stepEnded");
        // Nothing on the page is wider than the viewport.
        expect(
          await page.evaluate(
            () =>
              document
                .querySelector('[data-testid="widget-panel"]')!
                .getBoundingClientRect().right <=
              document.documentElement.clientWidth,
          ),
        ).toBe(true);
        await mkdir(EVIDENCE, { recursive: true });
        await page.screenshot({
          path: path.join(EVIDENCE, `plot-${vp}-${theme}.png`),
        });
      });

      test("heatmap widget: editing a score and the temperature recompute the softmax at once, clock untouched", async ({
        page,
      }) => {
        await openEnded(page, "heatmap");
        await expect(panel(page)).toHaveAttribute("data-kind", "heatmap");
        await expect(card(page).getByTestId("widget-prompt")).toHaveText(
          FAKE_WIDGETS.heatmap.prompt,
        );
        const t0 = await clock(page);
        const view = (r: number, c: number) =>
          drawing(page).locator(`[data-cell="${r},${c}"]`);
        await expect(view(0, 2)).toHaveAttribute("data-value", "0.1");
        // Raise The -> sat's score from 0.1 to 5: that weight takes over row 0.
        const score = panel(page).getByRole("spinbutton", {
          name: "Score, The, sat",
        });
        await score.fill("5");
        await expect(view(0, 2)).toHaveAttribute("data-value", "0.94");
        // A colder temperature sharpens row 1 (cat -> cat was 0.8).
        await drag(
          panel(page).getByRole("slider", { name: "Temperature" }),
          0.02,
        );
        await expect(view(1, 1)).toHaveAttribute("data-value", "1");
        expect(await clock(page)).toBe(t0);
        await expect(player(page)).toHaveAttribute("data-state", "stepEnded");
        await mkdir(EVIDENCE, { recursive: true });
        await page.screenshot({
          path: path.join(EVIDENCE, `heatmap-${vp}-${theme}.png`),
        });
      });
    });

test("replay hides the widget while replaying, and it is back at the end", async ({
  page,
}) => {
  await openEnded(page, "plot");
  await expect(panel(page)).toBeVisible();
  await sayAgain(page).click();
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await expect(panel(page)).toHaveCount(0);
  await expect(card(page).getByTestId("widget-prompt")).toHaveCount(0);
  await seekToEnd(page, FAKE_AUDIO_MS);
  await expect(panel(page)).toBeVisible();
});

test("Next takes the widget away; a step without one ends with nothing new", async ({
  page,
}) => {
  await openEnded(page, "plot");
  await expect(panel(page)).toBeVisible();
  await nextIdea(page).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(player(page)).toHaveAttribute("data-step", "1");
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await seekToEnd(page, FAKE_AUDIO_MS);
  await expect(panel(page)).toHaveCount(0);
  await expect(card(page).getByTestId("widget-prompt")).toHaveCount(0);
});

test("Hide folds the panel to its bar, Show brings it back with its values; Reset restores them", async ({
  page,
}) => {
  await openEnded(page, "plot");
  const slider = panel(page).getByRole("slider", { name: "Height a" });
  await drag(slider, 0.95);
  const moved = await panel(page).getByTestId("value-a").textContent();
  await panel(page).getByRole("button", { name: "Hide" }).click();
  await expect(panel(page)).toHaveAttribute("data-open", "false");
  await expect(drawing(page)).toBeHidden();
  await panel(page).getByRole("button", { name: "Show" }).click();
  await expect(panel(page).getByTestId("value-a")).toHaveText(moved!);
  await panel(page).getByRole("button", { name: "Reset" }).click();
  await expect(panel(page).getByTestId("value-a")).toHaveText("1");
});

test("lesson page: the widget stays when Ask opens at the end of the step", async ({
  page,
}) => {
  await using run = await savedRun("e2e-widget-ask", {
    widget: FAKE_WIDGETS.heatmap,
  });
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await seekToEnd(page, SAVED_AUDIO_MS);
  await expect(panel(page)).toBeVisible();
  await askByKey(page);
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId("ask-panel")).toBeVisible();
});
