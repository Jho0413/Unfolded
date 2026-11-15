// The paper beside the whiteboard (issue #98, ARCHITECTURE.md section 5.6): a narration cue
// highlights its passage and grows the paper, highlight_paper (the scripted fake conversation)
// highlights in the answer blue, a click on the whiteboard focuses it, and with no paper the
// whiteboard has the whole stage. The PDF is ./support/paperPdf.ts, served by intercepting
// GET /api/runs/<id>/paper.pdf. Screenshots of both focus states go to evidence/98/.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { CARD_TEXT } from "@/player/cardView";
import { PAPER_PAGES, paperPdf } from "./support/paperPdf";
import { savedRun } from "./support/savedRun";
import { askQuestion } from "./support/tutor";

test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  viewport: { width: 1440, height: 900 },
});

const EVIDENCE = path.join(process.cwd(), "evidence", "98");
async function screenshot(page: Page, name: string) {
  await mkdir(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, `${name}.png`) });
}

const player = (page: Page) => page.getByTestId("player");
const split = (page: Page) => page.getByTestId("stage-split");
const boardPane = (page: Page) => page.getByTestId("board-pane");
const paperPane = (page: Page) => page.getByTestId("paper-pane");
const paper = (page: Page) => page.getByTestId("paper");

const REFS = [
  { page: 1, quote: "We show how to multiply two matrices" },
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

const width = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => el.getBoundingClientRect().width);

/** Waits until the pane in focus is clearly the larger (the flex-basis transition ends). */
async function expectLarger(page: Page, larger: string, smaller: string) {
  await expect
    .poll(
      async () => (await width(page, larger)) / (await width(page, smaller)),
    )
    .toBeGreaterThan(1.4);
}

async function seek(page: Page, seconds: number) {
  await page.getByTestId("player-audio").evaluate(
    (audio: HTMLAudioElement, t) =>
      new Promise<void>((resolve) => {
        audio.addEventListener("seeked", () => resolve(), { once: true });
        audio.currentTime = t;
      }),
    seconds,
  );
}

test("no paper: no paper pane, the whiteboard has the whole stage", async ({
  page,
}) => {
  await using run = await savedRun("e2e-paper-none", { paperRefs: REFS });
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await expect(split(page)).toHaveAttribute("data-paper", "0");
  await expect(paperPane(page)).toHaveCount(0);
  const [board, stage] = await Promise.all([
    width(page, "board-pane"),
    width(page, "stage-split"),
  ]);
  expect(board).toBeCloseTo(stage, 0);
});

test("a narration cue highlights its passage and grows the paper; a click on the whiteboard focuses it", async ({
  page,
}) => {
  await using run = await savedRun("e2e-paper-cue", { paperRefs: REFS });
  await servePaper(page, run.lessonId);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(paper(page)).toHaveAttribute(
    "data-pages",
    String(PAPER_PAGES.length),
  );
  // The keyboard holds on: a click would focus the whiteboard.
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await page.keyboard.press("Space");
  await expect(player(page)).toHaveAttribute("data-state", "paused");

  // From the start: the ref with no cue, on page 1.
  await seek(page, 0.2);
  await expect(paper(page)).toHaveAttribute("data-highlight-page", "1");
  await expect(paper(page)).toHaveAttribute(
    "data-highlight-text",
    "We show how to multiply two matrices",
  );

  // At [[add]]: page 2, across the hyphenated line break, and the paper grows.
  await seek(page, 5.6);
  await expect(paper(page)).toHaveAttribute("data-highlight-page", "2");
  await expect(paper(page)).toHaveAttribute(
    "data-highlight-text",
    "The products of the pairedentries are add-ed together",
  );
  await expect(paper(page).locator("mark").first()).toBeInViewport();
  await expect(split(page)).toHaveAttribute("data-focus", "paper");
  await expectLarger(page, "paper-pane", "board-pane");
  await screenshot(page, "paper-focus-dark");

  // A click on the whiteboard (away from the tutor card) gives it focus.
  await boardPane(page).click({ position: { x: 40, y: 40 } });
  await expect(split(page)).toHaveAttribute("data-focus", "board");
  await expectLarger(page, "board-pane", "paper-pane");
  await screenshot(page, "board-focus-dark");

  // The light theme, focused on the paper again by a click.
  await page.getByRole("button", { name: "Switch light or dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await paperPane(page).click({ position: { x: 40, y: 40 } });
  await expect(split(page)).toHaveAttribute("data-focus", "paper");
  await expectLarger(page, "paper-pane", "board-pane");
  await screenshot(page, "paper-focus-light");
});

test("a passage far down the paper stays in view while the pane widens, and after", async ({
  page,
}) => {
  await using run = await savedRun("e2e-paper-deep", {
    paperRefs: [
      {
        page: 5,
        quote:
          "Deep down the paper, the scaled scores are what the softmax sees.",
        cue: "add",
      },
    ],
  });
  await servePaper(page, run.lessonId);
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(paper(page)).toHaveAttribute(
    "data-pages",
    String(PAPER_PAGES.length),
  );
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await page.keyboard.press("Space");
  await expect(split(page)).toHaveAttribute("data-focus", "board");
  // The cue fires while playing, so the pane starts to widen as the passage is scrolled to.
  await seek(page, 5.3);
  await page.keyboard.press("Space");
  await expect(paper(page)).toHaveAttribute("data-highlight-page", "5");
  // Hold on at once: the step's audio would otherwise end, and Space there replays it.
  await page.keyboard.press("Space");
  await expect(player(page)).toHaveAttribute("data-state", "paused");
  await expect(split(page)).toHaveAttribute("data-focus", "paper");
  await expectLarger(page, "paper-pane", "board-pane");
  const mark = paper(page).locator("mark").first();
  await expect(mark).toBeInViewport();
  await page.waitForTimeout(800); // well after the 0.45 s transition
  await expect(mark).toBeInViewport();
  await screenshot(page, "deep-passage-grown");
  // The pane shrinks back once the hold ends; the passage stays in view.
  await expect(split(page)).toHaveAttribute("data-focus", "board", {
    timeout: 10_000,
  });
  await page.waitForTimeout(800);
  await expect(mark).toBeInViewport();
});

test("a phone (390 px): the stage and both panes fit the screen, one tab at a time (phone.spec.ts has the tabs)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await using run = await savedRun("e2e-paper-phone");
  await servePaper(page, run.lessonId);
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(paper(page)).toHaveAttribute(
    "data-pages",
    String(PAPER_PAGES.length),
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  for (const pane of ["board-pane", "paper-pane"]) {
    const box = (await page.getByTestId(pane).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  // Both panes share the screen's space; the tab not chosen is hidden, not unmounted.
  const board = (await boardPane(page).boundingBox())!;
  const paperBox = (await paperPane(page).boundingBox())!;
  expect(Math.abs(paperBox.y - board.y)).toBeLessThan(1);
  await expect(boardPane(page)).toBeVisible();
  await expect(paperPane(page)).toBeHidden();
  await screenshot(page, "phone-tabs");
});

test("Ask tells the agent the step's passages verbatim, with page and label (QA A1)", async ({
  page,
}) => {
  await using run = await savedRun("e2e-paper-context", {
    paperRefs: [{ ...REFS[0], label: "Abstract" }, REFS[1]],
  });
  await servePaper(page, run.lessonId);
  await page.goto(`/lesson/${run.lessonId}`);
  await askQuestion(page, "Where does the paper say that?");
  await expect
    .poll(() => page.evaluate(() => window.__qaFake?.contextUpdates.at(-1)))
    .toContain(
      [
        "Passages this step quotes (verbatim):",
        '- p.1 (Abstract) "We show how to multiply two matrices"',
        '- p.2 "The products of the paired entries are added together"',
      ].join("\n"),
    );
});

test("highlight_paper from the conversation highlights its quote in the answer blue", async ({
  page,
}) => {
  await using run = await savedRun("e2e-paper-ask");
  await servePaper(page, run.lessonId);
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(paper(page)).toHaveAttribute(
    "data-pages",
    String(PAPER_PAGES.length),
  );
  await expect(paper(page)).toHaveAttribute("data-highlight-key", "");

  await askQuestion(page, "Where does it say that in the paper?");
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  await expect(paper(page)).toHaveAttribute(
    "data-highlight-text",
    "every output cell is a row times a column",
  );
  await expect(paper(page)).toHaveAttribute("data-highlight-page", "2");
  await expect(paper(page).locator('mark[data-tone="answer"]')).toHaveCount(1);
  await expect(split(page)).toHaveAttribute("data-focus", "paper");
  // The card tags the answer as pointing at the paper (#91).
  await expect(page.getByTestId("answer-tag")).toHaveText(
    CARD_TEXT.tagPointingPaper,
  );

  // Closing Ask throws the answer's highlight away.
  await page.keyboard.press("Escape");
  await expect(player(page)).not.toHaveAttribute("data-state", "asking");
  await expect(paper(page)).toHaveAttribute("data-highlight-key", "");
});
