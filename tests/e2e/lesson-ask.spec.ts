// The Ask panel on the lesson page (issue #77, ARCHITECTURE.md section 8),
// with the fake conversation (NEXT_PUBLIC_FAKE_APIS=1) and a saved run
// (./support/savedRun.ts, demo-m1 steps). /api/sketch is faked per test.
// The panel's own cases (every Ask message, keys, mic) are in ask.spec.ts.
import { expect, type Page, test } from "@playwright/test";
import { savedRun } from "./support/savedRun";

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

async function typeQuestion(page: Page, text: string) {
  await page.getByLabel("Type your question").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

const SKETCH = {
  objects: [
    { kind: "text", id: "note", x: 800, y: 700, text: "row times column" },
  ],
  actions: [{ do: "highlight", target: { id: "b", col: 1 }, atMs: 0 }],
};

test("typed question -> asking -> highlight and draw -> close -> back to paused, board restored", async ({
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
  await page
    .getByRole("toolbar", { name: "Player controls" })
    .getByRole("button", { name: "Pause" })
    .click();
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

  await page.getByRole("button", { name: "Ask", exact: true }).click();
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
  expect(body.fresh).toBe(false);
  expect(body.board.objects.map((o) => o.object.id)).toContain("a");
  await expect(
    page.getByTestId("ask-transcript").locator('[data-role="agent"]').last(),
  ).toContainText("Let me sketch that");
  const note = board(page).locator('[data-object-id="note"]');
  await expect(note).toHaveCount(0);
  release();
  await expect(note).toHaveCount(1);
  await expect(cell(page, "b", 0, 1)).toHaveAttribute(
    "data-highlight",
    "accent",
  );

  await page.getByRole("button", { name: "Close" }).click();
  await expect(player(page)).toHaveAttribute("data-state", "paused");
  await expect(note).toHaveCount(0);
  await expect.poll(() => boardAttributes(page)).toBe(before);
});

test("go_to_step while asking loads that step paused after close", async ({
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
  await expect(
    page.getByTestId("ask-transcript").locator('[data-role="agent"]').last(),
  ).toContainText("once you close this");
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(player(page)).toHaveAttribute("data-state", "paused");
  await expect(player(page)).toHaveAttribute("data-step", "1");
});
