// QA A10 (phone, 390 px): a highlighted passage is scrolled into the part of the paper the
// floating tutor card and Ask box leave uncovered, for an answer that points at the paper and
// for a narration passage at the very end of the paper (where the pane can't scroll further
// without the room the dock needs). Light and dark; screenshots go to evidence/a10/.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { CARD_TEXT } from "@/player/cardView";
import { paperPdf } from "./support/paperPdf";
import { SAVED_AUDIO_MS, savedRun } from "./support/savedRun";
import { askQuestion, card } from "./support/tutor";

test.use({
  viewport: { width: 390, height: 844 },
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

const EVIDENCE = path.join(process.cwd(), "evidence", "a10");
const paper = (page: Page) => page.getByTestId("paper");

async function openWithPaper(page: Page, lessonId: string): Promise<void> {
  await page.route(`**/api/runs/${lessonId}/paper.pdf`, (route) =>
    route.fulfill({ body: paperPdf(), contentType: "application/pdf" }),
  );
  await page.goto(`/lesson/${lessonId}`);
  await expect(page.getByTestId("player")).toHaveAttribute(
    "data-state",
    "playing",
  );
  await expect(paper(page)).not.toHaveAttribute("data-pages", "0");
}

/** The passage is on screen, wholly above the dock (the card and the Ask box). */
async function expectPassageClear(page: Page) {
  const mark = paper(page).locator("mark").first();
  await expect(mark).toBeVisible();
  await expect(async () => {
    const m = (await mark.boundingBox())!;
    const dock = (await card(page).boundingBox())!;
    const pane = (await paper(page).boundingBox())!;
    expect(m.y).toBeGreaterThanOrEqual(pane.y);
    expect(m.y + m.height).toBeLessThanOrEqual(dock.y);
  }).toPass({ timeout: 5000 });
}

for (const theme of ["light", "dark"] as const)
  test.describe(theme, () => {
    test.use({ colorScheme: theme });

    test("an answer pointing at the paper: its passage sits above the answer card", async ({
      page,
    }) => {
      await using run = await savedRun(`e2e-a10-ask-${theme}`);
      await openWithPaper(page, run.lessonId);
      await askQuestion(page, "Where does it say that in the paper?");
      await expect(page.getByTestId("answer-tag")).toHaveText(
        CARD_TEXT.tagPointingPaper,
      );
      await expect(page.getByTestId("tab-paper")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expectPassageClear(page);
      await mkdir(EVIDENCE, { recursive: true });
      await page.screenshot({
        path: path.join(EVIDENCE, `ask-390-${theme}.png`),
      });
    });

    test("a passage at the very end of the paper still scrolls up above the card", async ({
      page,
    }) => {
      await using run = await savedRun(`e2e-a10-end-${theme}`, {
        paperRefs: [
          {
            page: 5,
            quote:
              "Deep down the paper, the scaled scores are what the softmax sees.",
          },
        ],
      });
      await openWithPaper(page, run.lessonId);
      await page.getByTestId("tab-paper").click();
      // The step's end: the card at its fullest (the prompt and its buttons).
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
      await expect(paper(page)).toHaveAttribute("data-highlight-page", "5");
      await expectPassageClear(page);
      await mkdir(EVIDENCE, { recursive: true });
      await page.screenshot({
        path: path.join(EVIDENCE, `end-390-${theme}.png`),
      });
    });
  });
