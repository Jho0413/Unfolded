// The Ask panel on the lesson page (issue #77, ARCHITECTURE.md section 8),
// with the fake conversation (NEXT_PUBLIC_FAKE_APIS=1) and a saved run
// (./support/savedRun.ts, demo-m1 steps). /api/sketch is faked per test.
// The panel's own cases (every Ask message, keys, mic) are in ask.spec.ts.
import { expect, type Page, test } from "@playwright/test";
import { savedRun, savedStepTitle } from "./support/savedRun";
import {
  answer,
  askByKey,
  askQuestion,
  carryOn,
  holdOn,
} from "./support/tutor";

test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

const player = (page: Page) => page.getByTestId("player");
const board = (page: Page) => page.getByTestId("whiteboard");
const cell = (page: Page, id: string, r: number, c: number) =>
  board(page).locator(`[data-object-id="${id}"] [data-cell="${r},${c}"]`);

/** Every data-* attribute on the whiteboard, in document order. */
function boardAttributes(page: Page): Promise<string> {
  return board(page).evaluate((svg) =>
    [svg, ...svg.querySelectorAll("*")]
      .flatMap((el) =>
        [...el.attributes]
          .filter((a) => a.name.startsWith("data-"))
          .map((a) => `${a.name}=${a.value}`),
      )
      .join("\n"),
  );
}

const typeQuestion = askQuestion;

/** A drawn answer: on its own board (the Answer view), so it names only its own objects. */
const SKETCH = {
  objects: [
    { kind: "text", id: "note", x: 800, y: 450, text: "row times column" },
  ],
  actions: [{ do: "highlight", target: { id: "note" }, atMs: 0 }],
};

test("typed question -> asking -> highlight, then draw (the Answer view) -> carry on -> the lesson goes on, board restored", async ({
  page,
}) => {
  await using run = await savedRun("e2e-lesson-ask");
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/sketch", async (route) => {
    await gate;
    await route.fulfill({ json: { sketch: SKETCH } });
  });
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await holdOn(page).click();
  await expect(player(page)).toHaveAttribute("data-state", "paused");
  // Back to t = 0 (no cue fired yet), so the board doesn't depend on when the pause landed.
  await page.getByTestId("player-audio").evaluate(
    (audio: HTMLAudioElement) =>
      new Promise<void>((resolve) => {
        audio.addEventListener("seeked", () => resolve(), { once: true });
        audio.currentTime = 0;
      }),
  );
  await expect
    .poll(() =>
      page
        .getByTestId("player-audio")
        .evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBe(0);
  await expect(cell(page, "a", 0, 0)).toHaveAttribute("data-highlight", "none");
  // The board has settled once two readings a moment apart agree.
  let before = "";
  await expect
    .poll(async () => {
      const prev = before;
      before = await boardAttributes(page);
      return before === prev;
    })
    .toBe(true);

  await askByKey(page);
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  await expect(page.getByTestId("ask-panel")).toHaveAttribute(
    "data-phase",
    "connected",
  );
  // The context names the lesson's board, so the fake highlights a real id.
  await expect
    .poll(() => page.evaluate(() => window.__qaFake?.contextUpdates[0]))
    .toContain("(ids for highlight): a,");
  const ctx = await page.evaluate(() => window.__qaFake?.contextUpdates[0]);
  expect(ctx).toContain("(current step)");

  await typeQuestion(page, "show me the first row");
  await expect(cell(page, "a", 0, 0)).toHaveAttribute(
    "data-highlight",
    "accent",
  );
  await expect(cell(page, "a", 1, 0)).toHaveAttribute("data-highlight", "none");

  const request = page.waitForRequest("**/api/sketch");
  await typeQuestion(page, "can you draw it?");
  const body = (await request).postDataJSON() as {
    fresh: boolean;
    board: { objects: { object: { id: string } }[] };
  };
  // Always a fresh answer board, whatever the agent asked (the fake passes fresh: false).
  expect(body.fresh).toBe(true);
  expect(body.board.objects).toEqual([]);
  await expect(answer(page)).toContainText("Let me sketch that");
  const note = board(page).locator('[data-object-id="note"]');
  await expect(note).toHaveCount(0);
  release();
  // The Answer view: the drawing alone, the lesson hidden.
  await expect(page.getByTestId("answer-view")).toBeVisible();
  await expect(note).toHaveCount(1);
  await expect(note).toHaveAttribute("data-highlight", "accent");
  await expect(board(page).locator('[data-object-id="a"]')).toHaveCount(0);

  // Carry on: Ask closes (paused), then the lesson resumes; the drawing is thrown away.
  await carryOn(page).click();
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await expect(note).toHaveCount(0);
  // Held at t = 0 again, the board is the one from before Ask.
  await holdOn(page).click();
  await seek(page, 0);
  await expect.poll(() => boardAttributes(page)).toBe(before);
});

test("go_to_step while asking loads that step paused after carry on", async ({
  page,
}) => {
  await using run = await savedRun("e2e-lesson-ask-goto");
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await page.keyboard.press("a");
  await expect(page.getByTestId("ask-panel")).toHaveAttribute(
    "data-phase",
    "connected",
  );
  await typeQuestion(page, "go to step 2");
  await expect(answer(page)).toContainText("once you close this");
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  // The board stays on step 1 while asking; the agent is told step 2 is next.
  await expect(player(page)).toHaveAttribute("data-step", "0");
  await expect
    .poll(() => page.evaluate(() => window.__qaFake?.contextUpdates.at(-1)))
    .toContain("(next, after this question)");
  // The jumped-to step loads paused (the narration never talks over the agent).
  await carryOn(page).click();
  await expect(player(page)).toHaveAttribute("data-state", "paused");
  await expect(player(page)).toHaveAttribute("data-step", "1");
});

/** Seeks the paused audio and waits for the seek to land. */
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

test("Ask opened mid-fade: the fade completes with nothing drawn", async ({
  page,
}) => {
  await using run = await savedRun("e2e-lesson-ask-fade");
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await holdOn(page).click();
  await expect(player(page)).toHaveAttribute("data-state", "paused");
  // 1.1 s: 100 ms into the 300 ms highlight of row 0 of a (cue "row" at 1 s).
  await seek(page, 1.1);
  const opacity = () =>
    cell(page, "a", 0, 0).getAttribute("data-highlight-opacity");
  await expect.poll(async () => Number(await opacity())).toBeLessThan(1);
  await askByKey(page);
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  // Q&A time is pausedT + the time since Ask opened (ARCH 5.3).
  await expect.poll(opacity).toBe("1");
});

test("Ask while loading: the board stays empty when the step arrives, then plays from 0 after carry on", async ({
  page,
}) => {
  await using run = await savedRun("e2e-lesson-ask-loading");
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  // Hold step 0's request to the step route (ROADMAP L3) until Ask is open.
  await page.route(`**/api/lessons/${run.lessonId}/steps/0`, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "loading");
  await askByKey(page);
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  await expect(page.getByTestId("ask-panel")).toHaveAttribute(
    "data-phase",
    "connected",
  );
  await expect
    .poll(() => page.evaluate(() => window.__qaFake?.contextUpdates[0]))
    .toContain("The board is empty.");
  release();
  // The step arrives while asking (its title shows in the player's header),
  // but the board stays the empty one Ask froze.
  const a = board(page).locator('[data-object-id="a"]');
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(
    savedStepTitle(0),
  );
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  await expect(a).toHaveCount(0);
  await carryOn(page).click();
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await expect(player(page)).toHaveAttribute("data-step", "0");
  await expect(a).toHaveCount(1);
});
