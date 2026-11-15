// Typed Ask with the mic blocked (rehearsal finding 2), on the lesson page with the
// fake conversation (NEXT_PUBLIC_FAKE_APIS=1) and a saved run. No mic permission is granted and
// the fake's mic request is refused (window.__qaFakeMicDenied), so there's no lesson voice
// session and Ask is text-only. A text-only session goes over the websocket: on WebRTC the real
// server never answers one that sends no audio, and hangs up about 12 s later. If a session
// does end with the question unanswered, Ask stays open with "Q&A ended unexpectedly." and Retry.
import { expect, type Page, test } from "@playwright/test";
import { savedRun } from "./support/savedRun";
import {
  answer,
  askQuestion,
  card,
  cardButton,
  carryOn,
  retry,
} from "./support/tutor";

test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

const ENDED = "Q&A ended unexpectedly.";
const player = (page: Page) => page.getByTestId("player");
const panel = (page: Page) => page.getByTestId("ask-panel");
const notice = (page: Page) => page.getByTestId("ask-notice");
const starts = (page: Page) => page.evaluate(() => window.__qaFake?.starts);

test.beforeEach(async ({ context, page }) => {
  // The learner blocked the mic: nothing is granted, and the fake's mic request is refused.
  await context.clearPermissions();
  await page.addInitScript(() => {
    (window as { __qaFakeMicDenied?: boolean }).__qaFakeMicDenied = true;
  });
});

/** The lesson plays with no voice session; a typed question opens a text-only Ask. */
async function askTyped(page: Page, lessonId: string, question: string) {
  await page.goto(`/lesson/${lessonId}`);
  // Ask opens from either (the browser may hold autoplay back under load).
  await expect(player(page)).toHaveAttribute(
    "data-state",
    /^(playing|paused)$/,
  );
  await askQuestion(page, question);
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  await expect(panel(page)).toHaveAttribute("data-phase", "connected");
}

test("a typed question is answered over a text-only websocket session", async ({
  page,
}) => {
  await using run = await savedRun("e2e-mic-blocked-typed");
  await askTyped(page, run.lessonId, "What is this?");
  await expect(answer(page)).toContainText("row times a column");
  await expect(panel(page)).toHaveAttribute("data-text-only", "true");
  await expect(panel(page)).toHaveAttribute("data-transport", "websocket");
  expect(await starts(page)).toEqual(["websocket"]);
});

test("the agent hangs up on an unanswered question: the message and Retry, not a silent close; Retry answers it", async ({
  page,
}) => {
  await using run = await savedRun("e2e-mic-blocked-hangup");
  await askTyped(page, run.lessonId, "What is this?");
  await expect(answer(page)).toContainText("row times a column");
  // The agent hears the next question but never answers it, then hangs up (the rehearsal's
  // session).
  await page.evaluate(() => {
    if (window.__qaFake) window.__qaFake.unanswering = true;
  });
  // Sent once connected; the agent says nothing back.
  await askQuestion(page, "Why rows times columns?");
  await expect(card(page)).toContainText("Thinking…");
  await page.evaluate(() => {
    if (window.__qaFake) window.__qaFake.unanswering = false;
    window.__qaFake?.hangUp();
  });
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  await expect(notice(page)).toHaveText(ENDED);
  await expect(card(page)).toContainText("Why rows times columns?");
  await expect(retry(page)).toBeVisible();
  await expect(carryOn(page)).toBeVisible();

  // Retry: a fresh text-only session, the question sent again and answered.
  await retry(page).click();
  await expect(notice(page)).toHaveCount(0);
  await expect(answer(page)).toContainText("row times a column");
  await expect(card(page)).toContainText("Why rows times columns?");
  expect(await starts(page)).toEqual(["websocket", "websocket"]);
});

test("the session drops: the message and Retry; Carry on goes back to the lesson, the message gone", async ({
  page,
}) => {
  await using run = await savedRun("e2e-mic-blocked-drop");
  await askTyped(page, run.lessonId, "What is this?");
  await expect(answer(page)).toContainText("row times a column");
  await page.evaluate(() => window.__qaFake?.drop());
  await expect(notice(page)).toHaveText(ENDED);
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  await expect(retry(page)).toBeVisible();
  await cardButton(page, "Carry on").click();
  await expect(player(page)).not.toHaveAttribute("data-state", "asking");
  await expect(notice(page)).toHaveCount(0);
});
