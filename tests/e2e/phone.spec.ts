// The lesson page on a phone (390 px, also 360 and 430; ARCHITECTURE.md section 5.6): the compact
// tutor card and its More / Less, the Board / Paper tabs (the learner's tab wins), the widget
// panel within reach, Ask and the always-on mic visible, 44 px targets, no horizontal scroll, and
// the desktop unchanged. Saved runs from ./support/savedRun.ts; the PDF from ./support/paperPdf.ts.
// Screenshots go to evidence/phone/.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { FAKE_WIDGETS } from "@/app/dev/player/fakeWidgets";
import { paperPdf } from "./support/paperPdf";
import { SAVED_AUDIO_MS, savedRun } from "./support/savedRun";
import { askQuestion, card } from "./support/tutor";

test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  viewport: { width: 390, height: 844 },
});

const EVIDENCE = path.join(process.cwd(), "evidence", "phone");
async function screenshot(page: Page, name: string) {
  await mkdir(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, `${name}.png`) });
}

const player = (page: Page) => page.getByTestId("player");
const split = (page: Page) => page.getByTestId("stage-split");
const more = (page: Page) => page.getByTestId("card-more");
const audio = (page: Page) => page.getByTestId("player-audio");

const REFS = [
  {
    page: 2,
    quote: "The products of the paired entries are added together",
    cue: "add",
  },
];

async function servePaper(page: Page, lessonId: string) {
  await page.route(`**/api/runs/${lessonId}/paper.pdf`, (route) =>
    route.fulfill({ body: paperPdf(), contentType: "application/pdf" }),
  );
}

async function seek(page: Page, seconds: number) {
  await audio(page).evaluate(
    (a: HTMLAudioElement, t) =>
      new Promise<void>((resolve) => {
        a.addEventListener("seeked", () => resolve(), { once: true });
        a.currentTime = t;
      }),
    seconds,
  );
}

async function holdOnByKey(page: Page) {
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await page.keyboard.press("Space");
  await expect(player(page)).toHaveAttribute("data-state", "paused");
}

async function endStep(page: Page) {
  await audio(page).evaluate(
    (a: HTMLAudioElement, s) => {
      a.currentTime = s;
    },
    (SAVED_AUDIO_MS - 100) / 1000,
  );
  await expect(player(page)).toHaveAttribute("data-state", "stepEnded");
}

const box = async (l: Locator) => (await l.boundingBox())!;

/** Every visible button of the stage is at least 44 px tall. */
async function expectTouchTargets(page: Page) {
  const small = await page
    .getByTestId("lesson")
    .locator("button:visible")
    .evaluateAll((els) =>
      els
        .filter((el) => el.getBoundingClientRect().height < 44)
        .filter((el) => !el.closest('[data-testid="outline"]'))
        .map((el) => el.textContent || el.getAttribute("aria-label")),
    );
  expect(small).toEqual([]);
}

async function expectNoSideScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(width);
}

/** The drawing (the board's 16:9 box) is clear of the dock, and big enough to read. */
async function expectBoardClear(page: Page, minHeight = 150) {
  const drawing = await box(
    page.getByTestId("board-pane").locator("svg").first(),
  );
  const dock = await box(card(page).locator(".."));
  expect(drawing.y + drawing.height).toBeLessThanOrEqual(dock.y + 1);
  expect(drawing.height).toBeGreaterThanOrEqual(minHeight);
}

for (const theme of ["light", "dark"] as const)
  test(`compact card (${theme}): two lines while explaining, More / Less, full at the step's end; the board stays clear; Ask and the mic in reach`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await using run = await savedRun(`e2e-phone-card-${theme}`);
    await page.goto(`/lesson/${run.lessonId}`);
    await expect(player(page)).toHaveAttribute("data-state", "playing");
    await expect(card(page)).toHaveAttribute("data-compact", "1");
    await expect(more(page)).toBeVisible();
    await expect(more(page)).toHaveAttribute("aria-expanded", "false");
    // The always-on mic is listening, and the Ask box and mic are on screen.
    await expect(page.getByTestId("ask-listening")).toHaveText("Listening");
    await expect(page.getByTestId("ask-box")).toBeInViewport({ ratio: 1 });
    await seek(page, 2.5);
    await expectBoardClear(page);
    await expectNoSideScroll(page);
    await expectTouchTargets(page);
    await screenshot(page, `390-${theme}-explaining-compact`);

    await more(page).click();
    await expect(card(page)).toHaveAttribute("data-compact", "0");
    await expect(more(page)).toHaveText("Less");
    await expectBoardClear(page, 120);
    await more(page).click();
    await expect(card(page)).toHaveAttribute("data-compact", "1");

    // The end of the step: the full card, with its choices.
    await endStep(page);
    await expect(card(page)).toHaveAttribute("data-compact", "0");
    await expect(
      card(page).getByRole("button", { name: /^Next: / }),
    ).toBeVisible();
    await expect(
      card(page).getByRole("button", { name: "Say that again" }),
    ).toBeVisible();
    await expectTouchTargets(page);
    await screenshot(page, `390-${theme}-step-ended`);

    // Ask: a typed question opens the full Ask card with the answer.
    await askQuestion(page, "why rows?");
    await expect(player(page)).toHaveAttribute("data-state", "asking");
    await expect(page.getByTestId("ask-answer")).toBeVisible();
    await expect(page.getByTestId("ask-answer")).toBeInViewport();
    await screenshot(page, `390-${theme}-ask`);
  });

test("Board / Paper tabs: the focus rules pick the tab, the learner's tab wins for the step, the paper keeps its highlight", async ({
  page,
}) => {
  await using run = await savedRun("e2e-phone-tabs", { paperRefs: REFS });
  await servePaper(page, run.lessonId);
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(page.getByTestId("paper")).toHaveAttribute("data-pages", /\d+/);
  await holdOnByKey(page);
  const boardTab = page.getByTestId("tab-board");
  const paperTab = page.getByTestId("tab-paper");
  await expect(boardTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("board-pane")).toBeVisible();
  await expect(page.getByTestId("paper-pane")).toBeHidden();
  expect((await box(boardTab)).height).toBeGreaterThanOrEqual(44);

  // The passage's cue: the paper tab shows, with the passage in view.
  await seek(page, 5.6);
  await expect(split(page)).toHaveAttribute("data-tab", "paper");
  await expect(page.getByTestId("paper-pane")).toBeVisible();
  await expect(page.getByTestId("board-pane")).toBeHidden();
  await expect(
    page.locator('[data-testid="paper"] mark').first(),
  ).toBeInViewport();
  await expectNoSideScroll(page);
  await screenshot(page, "390-light-paper-tab");

  // The learner picks the board: it stays, and the paper tab shows a new passage is there.
  await boardTab.click();
  await expect(split(page)).toHaveAttribute("data-tab", "board");
  await seek(page, 0.2);
  await seek(page, 5.6);
  await expect(split(page)).toHaveAttribute("data-tab", "board");
  await expect(page.getByTestId("board-pane")).toBeVisible();
  await screenshot(page, "390-light-board-tab");

  // Back to the paper: the highlight is still there (the hidden pane kept its pages).
  await paperTab.click();
  await expect(page.getByTestId("paper")).toHaveAttribute(
    "data-highlight-page",
    "2",
  );
  await expect(
    page.locator('[data-testid="paper"] mark').first(),
  ).toBeInViewport();
});

test("widget panel: within reach and under 40 % of the screen, the board still showing above it; Hide folds it", async ({
  page,
}) => {
  await using run = await savedRun("e2e-phone-widget", {
    widget: FAKE_WIDGETS.plot,
  });
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await endStep(page);
  const panel = page.getByTestId("widget-panel");
  await expect(panel).toBeVisible();
  expect((await box(panel)).height).toBeLessThanOrEqual(844 * 0.4 + 1);
  const slider = panel.getByRole("slider").first();
  await slider.scrollIntoViewIfNeeded();
  await expect(slider).toBeInViewport({ ratio: 1 });
  await expectBoardClear(page, 60);
  await expectNoSideScroll(page);
  await screenshot(page, "390-light-widget");
  await panel.getByRole("button", { name: "Hide" }).click();
  await expect(panel).toHaveAttribute("data-open", "false");
  await expectBoardClear(page, 120);
});

for (const width of [360, 430])
  test(`${width} px: no horizontal scroll, the card compact, the board clear`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await using run = await savedRun(`e2e-phone-${width}`, {
      paperRefs: REFS,
    });
    await servePaper(page, run.lessonId);
    await page.goto(`/lesson/${run.lessonId}`);
    await expect(page.getByTestId("pane-tabs")).toBeVisible();
    await holdOnByKey(page);
    await seek(page, 2.5);
    await expect(card(page)).toHaveAttribute("data-compact", "1");
    await expectBoardClear(page, 120);
    await expectNoSideScroll(page);
    await expectTouchTargets(page);
    await screenshot(page, `${width}-light-holding`);
  });

test("desktop (1440 px) is unchanged: no tabs or More, the panes side by side, the dock as before", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await using run = await savedRun("e2e-phone-desktop", { paperRefs: REFS });
  await servePaper(page, run.lessonId);
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(page.getByTestId("paper")).toHaveAttribute("data-pages", /\d+/);
  await holdOnByKey(page);
  await expect(page.getByTestId("pane-tabs")).toBeHidden();
  await expect(more(page)).toBeHidden();
  await expect(split(page)).toHaveAttribute("data-focus", "board");
  const board = await box(page.getByTestId("board-pane"));
  const paper = await box(page.getByTestId("paper-pane"));
  expect(paper.x).toBeGreaterThan(board.x + board.width);
  expect(Math.abs(board.y - paper.y)).toBeLessThan(1);
  // The dock: 720 px wide at most, 18 px above the board's bottom, as before.
  const dock = await box(card(page).locator(".."));
  expect(dock.width).toBeLessThanOrEqual(720);
  const gap = board.y + board.height - (dock.y + dock.height);
  expect(gap).toBeGreaterThan(17);
  expect(gap).toBeLessThan(21);
  await screenshot(page, "1440-light-desktop");
});
