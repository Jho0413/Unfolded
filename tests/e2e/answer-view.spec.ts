// The Answer view on the lesson page (#90, ARCHITECTURE.md section 5.6): a draw_scene answer
// shows on a clean board of its own, in the lesson's look, with an "Answer" tag and a
// "Back to step N" chip, instead of the lesson. One test per row of the Answer view table that
// needs a browser; the rest are in tests/unit/app/lesson/boardView.test.ts. Saved runs come
// from ./support/savedRun.ts, the conversation is the scripted fake (NEXT_PUBLIC_FAKE_APIS=1),
// /api/sketch is faked per test. Screenshots go to evidence/90/ (gitignored).
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { ANSWER_VIEW_TEXT } from "@/app/lesson/[lessonId]/boardView";
import { ANSWER_CONTEXT } from "@/qa/answerContext";
import { ANSWER_SHOWING } from "@/qa/tools";
import { CANVAS } from "@/shared/scene";
import { ANSWER_TEMPLATE } from "@/shared/validate";
import { savedRun } from "./support/savedRun";
import { answer, askQuestion, carryOn } from "./support/tutor";

test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

const player = (page: Page) => page.getByTestId("player");
const board = (page: Page) => page.getByTestId("whiteboard");
const answerView = (page: Page) => page.getByTestId("answer-view");
const backChip = (page: Page) => page.getByTestId("answer-view-back");
const object = (page: Page, id: string) =>
  board(page).locator(`[data-object-id="${id}"]`);
/** What the fake agent was told, in order. */
const contextUpdates = (page: Page) =>
  page.evaluate(() => window.__qaFake?.contextUpdates ?? []);

/** The fake agent's draw_scene description (qa/fakeConversation.ts). */
const DESCRIPTION = "Circle the first row of q";

/** Two answers laid out from the template, to tell a follow-up from the first. */
const answerSketch = (id: string, title: string) => ({
  objects: [
    { kind: "text", id: `${id}_title`, x: 800, y: 110, text: title },
    {
      kind: "matrix",
      id,
      x: 672,
      y: 420,
      rows: [["1", "2"]],
      label: "row",
    },
  ],
  actions: [{ do: "highlight", target: { id, row: 0 }, atMs: 0 }],
});
const FIRST = answerSketch("first", "Row times column");
const SECOND = answerSketch("second", "The same, again");

/** Serves FIRST, then SECOND for a follow-up. */
async function fakeSketches(page: Page) {
  let n = 0;
  await page.route("**/api/sketch", (route) =>
    route.fulfill({ json: { sketch: n++ === 0 ? FIRST : SECOND } }),
  );
}

/** Opens the lesson playing step 1, asks for a drawing and waits for the Answer view. */
async function drawnAnswer(page: Page, lessonId: string) {
  await fakeSketches(page);
  await page.goto(`/lesson/${lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await askQuestion(page, "can you draw it?");
  await expect(answerView(page)).toBeVisible();
}

test("draw_scene: the Answer view, with its tag and chip, instead of the lesson; the agent is told", async ({
  page,
}) => {
  await using run = await savedRun("e2e-answer-open");
  await drawnAnswer(page, run.lessonId);
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  await expect(page.getByTestId("answer-view-tag")).toHaveText(
    ANSWER_VIEW_TEXT.tag,
  );
  await expect(backChip(page)).toHaveText(ANSWER_VIEW_TEXT.back(1));
  // The drawing alone, in the lesson's own look: the lesson board is hidden, not dimmed.
  await expect(object(page, "first")).toHaveCount(1);
  await expect(object(page, "a")).toHaveCount(0);
  await expect(
    object(page, "first").locator('[data-cell="0,0"]'),
  ).toHaveAttribute("data-highlight", "accent");
  await expect
    .poll(() => contextUpdates(page))
    .toContain(ANSWER_CONTEXT.showing(DESCRIPTION));
});

test("a follow-up draw_scene replaces the drawing with the new one", async ({
  page,
}) => {
  await using run = await savedRun("e2e-answer-follow-up");
  await drawnAnswer(page, run.lessonId);
  await expect(object(page, "first")).toHaveCount(1);
  await askQuestion(page, "draw it again");
  await expect(object(page, "second")).toHaveCount(1);
  await expect(object(page, "first")).toHaveCount(0);
  await expect(object(page, "a")).toHaveCount(0);
});

test("Got it, carry on: back to the lesson, narrating again; the agent hears Back on the lesson", async ({
  page,
}) => {
  await using run = await savedRun("e2e-answer-carry-on");
  await drawnAnswer(page, run.lessonId);
  await expect(answer(page)).toContainText("Let me sketch that");
  await carryOn(page).click();
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await expect(answerView(page)).toHaveCount(0);
  await expect(object(page, "a")).toHaveCount(1);
  await expect.poll(() => contextUpdates(page)).toContain(ANSWER_CONTEXT.back);
});

test("the Back to step N chip: back to the lesson, paused where they were", async ({
  page,
}) => {
  await using run = await savedRun("e2e-answer-chip");
  await drawnAnswer(page, run.lessonId);
  await backChip(page).click();
  // Ask was opened while explaining; the chip still leaves it held, not narrating.
  await expect(player(page)).toHaveAttribute("data-state", "paused");
  await expect(answerView(page)).toHaveCount(0);
  await expect(object(page, "a")).toHaveCount(1);
  await expect.poll(() => contextUpdates(page)).toContain(ANSWER_CONTEXT.back);
});

test("Escape: back to the lesson, paused where they were", async ({ page }) => {
  await using run = await savedRun("e2e-answer-escape");
  await drawnAnswer(page, run.lessonId);
  await page.keyboard.press("Escape");
  await expect(player(page)).toHaveAttribute("data-state", "paused");
  await expect(answerView(page)).toHaveCount(0);
  await expect(object(page, "a")).toHaveCount(1);
});

test("Escape from the lesson (no drawing) still goes back to how it was: explaining resumes", async ({
  page,
}) => {
  await using run = await savedRun("e2e-answer-escape-lesson");
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await askQuestion(page, "what is this?");
  await expect(answer(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(player(page)).toHaveAttribute("data-state", "playing");
});

test("highlight while the Answer view is up: a no-op, and the agent is told why", async ({
  page,
}) => {
  await using run = await savedRun("e2e-answer-highlight");
  await drawnAnswer(page, run.lessonId);
  await askQuestion(page, "show me the first row");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__qaFake?.toolCalls
          .filter((c) => c.name === "highlight")
          .map((c) => c.result),
      ),
    )
    .toEqual([ANSWER_SHOWING]);
  await expect(answerView(page)).toBeVisible();
  await expect(object(page, "a")).toHaveCount(0);
});

const EVIDENCE = path.join(process.cwd(), "evidence", "90");
// The lesson page is laid out for a desktop browser (ARCHITECTURE.md section 1); the tag and
// chip scale with the board, so they stay above the answer area at any desktop width.
for (const theme of ["dark", "light"] as const)
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
  ] as const)
    test(`the tag and chip stay above the answer area at ${width} x ${height}, ${theme} (evidence)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: theme });
      await using run = await savedRun(`e2e-answer-shot-${theme}-${width}`);
      await drawnAnswer(page, run.lessonId);
      await expect(answer(page)).toContainText("Let me sketch that");
      // The highlight has faded in.
      await expect(
        object(page, "first").locator('[data-cell="0,0"]'),
      ).toHaveAttribute("data-highlight-opacity", "1");
      const svg = (await board(page).boundingBox())!;
      const areaTop = svg.y + (ANSWER_TEMPLATE.area.y0 / CANVAS.h) * svg.height;
      for (const id of ["answer-view-tag", "answer-view-back"]) {
        const box = (await page.getByTestId(id).boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(svg.y);
        expect(box.y + box.height).toBeLessThanOrEqual(areaTop);
      }
      await mkdir(EVIDENCE, { recursive: true });
      await page.screenshot({
        path: path.join(EVIDENCE, `e2e-answer-view-${theme}-${width}.png`),
      });
    });
