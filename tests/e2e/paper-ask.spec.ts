// "Ask about this" on a passage selected in the paper (issue #129, ARCHITECTURE.md section
// 5.6): a selection in the pages offers the chip beside it; the chip highlights the passage
// for a moment and opens Ask with the box prefilled `About "…" (p.N): ` and focused, and the
// agent (the scripted fake, window.__qaFake) is told the passage, so a typed or a spoken
// question works. At 1440 and 390 px, light and dark; screenshots go to evidence/129/.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { ASK_ABOUT_HIGHLIGHT_MS } from "@/player/paper/selection";
import { PAPER_PAGES, paperPdf } from "./support/paperPdf";
import { savedRun } from "./support/savedRun";
import { askInput } from "./support/tutor";

test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

const EVIDENCE = path.join(process.cwd(), "evidence", "129");
async function screenshot(page: Page, name: string) {
  await mkdir(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, `${name}.png`) });
}

const player = (page: Page) => page.getByTestId("player");
const paper = (page: Page) => page.getByTestId("paper");
const chip = (page: Page) => page.getByTestId("paper-ask-chip");
/** What the fake agent was told (contextual updates), and whether the mic is muted. */
const contextUpdates = (page: Page) =>
  page.evaluate(() => window.__qaFake?.contextUpdates ?? []);
const micMuted = (page: Page) => page.evaluate(() => window.__qaFake?.micMuted);

/** A whole line of page 2 of ./support/paperPdf.ts. */
const LINE = "In short, every output cell is a row times a column.";

async function openLesson(page: Page, name: string) {
  await using run = await savedRun(name);
  await page.route(`**/api/runs/${run.lessonId}/paper.pdf`, (route) =>
    route.fulfill({ body: paperPdf(), contentType: "application/pdf" }),
  );
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(paper(page)).toHaveAttribute(
    "data-pages",
    String(PAPER_PAGES.length),
  );
  // The lesson's voice session is listening (the agent can be told the passage at once).
  await expect(page.getByTestId("ask-listening")).toHaveText("Listening");
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await page.keyboard.press("Space");
  await expect(player(page)).toHaveAttribute("data-state", "paused");
  return run;
}

/** The text layer span holding `text`, scrolled into the middle of the pane. */
async function lineSpan(page: Page, text: string) {
  const span = paper(page).locator("[data-page] span", { hasText: text });
  await span.evaluate((el) => el.scrollIntoView({ block: "center" }));
  return span;
}

/**
 * Selects a line of the paper with the mouse, as the learner does: the mouse rests on the
 * paper (which focuses it: the pane grows), then drags across the line, once it's in view and
 * has stopped moving.
 */
async function dragAcross(page: Page, text: string) {
  await page.getByTestId("paper-pane").hover({ position: { x: 20, y: 20 } });
  await expect(page.getByTestId("stage-split")).toHaveAttribute(
    "data-focus",
    "paper",
  );
  const span = await lineSpan(page, text);
  let last = "";
  await expect
    .poll(async () => {
      await span.evaluate((el) => el.scrollIntoView({ block: "center" }));
      const now = JSON.stringify(await span.boundingBox());
      const still = now === last;
      last = now;
      return still;
    })
    .toBe(true);
  const box = (await span.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, y, { steps: 10 });
  await page.mouse.up();
}

const SIZES = [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 } },
] as const;

for (const { name, viewport } of SIZES)
  for (const theme of ["light", "dark"] as const)
    test(`${name} px, ${theme}: a selection offers "Ask about this"; it highlights the passage and opens Ask prefilled; a typed question goes with the quote`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme });
      await openLesson(page, `e2e-paper-ask-${name}-${theme}`);
      // On a phone the paper is a tab.
      if (name === "390") await page.getByTestId("tab-paper").click();

      await dragAcross(page, LINE);
      await expect(chip(page)).toBeVisible();
      // Beside the selection, inside the paper pane.
      const pane = (await page.getByTestId("paper-pane").boundingBox())!;
      const span = (await (await lineSpan(page, LINE)).boundingBox())!;
      const at = (await chip(page).boundingBox())!;
      expect(at.x).toBeGreaterThanOrEqual(pane.x);
      expect(at.x + at.width).toBeLessThanOrEqual(pane.x + pane.width);
      expect(Math.abs(at.y + at.height - span.y)).toBeLessThan(24);
      if (name === "390") expect(at.height).toBeGreaterThanOrEqual(44);
      await screenshot(page, `${name}-${theme}-chip`);

      await chip(page).click();
      await expect(chip(page)).toBeHidden();
      await expect(player(page)).toHaveAttribute("data-state", "asking");
      // The box: prefilled with the quote and its page, focused, in view.
      await expect(askInput(page)).toHaveValue(
        /^About "In short, every output cell is a row times a column\.?" \(p\.2\): $/,
      );
      await expect(askInput(page)).toBeFocused();
      await expect(askInput(page)).toBeInViewport({ ratio: 1 });
      // The passage, highlighted in the answer blue.
      await expect(paper(page)).toHaveAttribute(
        "data-highlight-text",
        /every output cell is a row times a column/,
      );
      await expect(paper(page).locator('mark[data-tone="answer"]')).toHaveCount(
        1,
      );
      // The agent knows the passage, and the mic stays on (the prefill isn't typing).
      await expect
        .poll(async () =>
          (await contextUpdates(page)).some(
            (u) =>
              u.includes("page 2") &&
              u.includes("every output cell is a row times a column"),
          ),
        )
        .toBe(true);
      expect(await micMuted(page)).toBe(false);
      await page.waitForTimeout(600); // the mark's fade-in, for the screenshot
      await screenshot(page, `${name}-${theme}-asking`);

      // The learner types the question after the prefill: it goes with the quote.
      await page.keyboard.type("why a row?");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("ask-question")).toContainText(
        /About ".*every output cell.*" \(p\.2\): why a row\?/,
      );
      await expect(page.getByTestId("ask-answer")).toBeVisible();

      // The highlight is brief.
      await expect(paper(page)).toHaveAttribute("data-highlight-key", "", {
        timeout: ASK_ABOUT_HIGHLIGHT_MS + 3000,
      });
    });

test("a spoken question works too: the prefill leaves the mic on, and the agent was told the passage", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLesson(page, "e2e-paper-ask-voice");
  await dragAcross(page, LINE);
  await chip(page).click();
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  await expect(askInput(page)).toBeFocused();
  await page.evaluate(() => window.__qaFake?.say("what does that mean?"));
  await expect(page.getByTestId("ask-question")).toContainText(
    "what does that mean?",
  );
  await expect(page.getByTestId("ask-answer")).toBeVisible();
  expect(
    (await contextUpdates(page)).some((u) =>
      u.includes("selected this passage"),
    ),
  ).toBe(true);
  // Typing over the prefill is a draft again: the mic goes off, as for any typed question.
  await page.keyboard.type("and why?");
  await expect.poll(() => micMuted(page)).toBe(true);
});

test("no chip for a selection outside the paper or too short; it goes when the selection does", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLesson(page, "e2e-paper-ask-none");
  // Two characters of the line: too short.
  await (
    await lineSpan(page, LINE)
  ).evaluate((el) => {
    const range = document.createRange();
    range.setStart(el.firstChild!, 0);
    range.setEnd(el.firstChild!, 2);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await page.waitForTimeout(200);
  await expect(chip(page)).toBeHidden();
  // The lesson's title, outside the paper.
  await page.getByRole("heading", { level: 2 }).selectText();
  await page.waitForTimeout(200);
  await expect(chip(page)).toBeHidden();
  // A line in the paper, then a click away: the chip comes and goes.
  await dragAcross(page, LINE);
  await expect(chip(page)).toBeVisible();
  await page.evaluate(() => getSelection()!.removeAllRanges());
  await expect(chip(page)).toBeHidden();
  await expect(player(page)).toHaveAttribute("data-state", "paused");
});

test("a drag that starts on the unfocused paper doesn't grow the pane under it; a click still focuses it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLesson(page, "e2e-paper-ask-drag");
  const split = page.getByTestId("stage-split");
  const pane = page.getByTestId("paper-pane");
  await expect(split).toHaveAttribute("data-focus", "board");
  const width = async () => (await pane.boundingBox())!.width;
  // The panes settle into their layout once the paper has loaded.
  let before = 0;
  await expect
    .poll(async () => {
      const now = await width();
      const still = Math.abs(now - before) < 0.5;
      before = now;
      return still;
    })
    .toBe(true);
  // Straight onto the line and pressing, with no rest on the paper first; then a slow drag,
  // longer than the hover focus (300 ms) and the pane's transition (0.45 s) together.
  const span = await lineSpan(page, LINE);
  const box = (await span.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 1, y);
  await page.mouse.down();
  const widths: number[] = [];
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(box.x + 1 + ((box.width - 2) * i) / 10, y);
    await page.waitForTimeout(100);
    widths.push(await width());
  }
  await page.mouse.up();
  expect(widths.every((w) => Math.abs(w - before) < 1)).toBe(true);
  await expect(split).toHaveAttribute("data-focus", "board");
  // The whole line is selected, and the chip sits beside it.
  expect(await page.evaluate(() => String(getSelection()))).toContain(
    "every output cell is a row times a column",
  );
  await expect(chip(page)).toBeVisible();
  const at = (await chip(page).boundingBox())!;
  const line = (await span.boundingBox())!;
  expect(Math.abs(at.y + at.height - line.y)).toBeLessThan(24);
  // A click (no drag) on the paper still focuses it.
  await page.evaluate(() => getSelection()!.removeAllRanges());
  await pane.click({ position: { x: 20, y: 20 } });
  await expect(split).toHaveAttribute("data-focus", "paper");
});
