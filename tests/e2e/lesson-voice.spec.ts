// The always-on mic on the lesson page (issue #93, ARCHITECTURE.md section 8), with the fake
// conversation (NEXT_PUBLIC_FAKE_APIS=1) and a saved run (./support/savedRun.ts). The fake's
// say(text) is the learner speaking: VAD scores about every 100 ms, then the transcript, then
// the scripted answer and its tool (qa/fakeConversation.ts).
import { expect, type Page, test } from "@playwright/test";
import { savedRun } from "./support/savedRun";
import { answer, askByKey, askInput, askQuestion } from "./support/tutor";

test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

const player = (page: Page) => page.getByTestId("player");
const panel = (page: Page) => page.getByTestId("ask-panel");
const listening = (page: Page) => page.getByTestId("ask-listening");
const audioPaused = (page: Page) =>
  page.getByTestId("player-audio").evaluate((a: HTMLAudioElement) => a.paused);
const say = (page: Page, text: string) =>
  page.evaluate((t) => window.__qaFake?.say(t), text);
const starts = (page: Page) => page.evaluate(() => window.__qaFake?.starts);
/** The lesson plays, and its voice session is listening. */
async function playing(page: Page, lessonId: string) {
  await page.goto(`/lesson/${lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await expect(listening(page)).toHaveText("Listening");
}

test("the lesson's first play opens a voice session (mic on), with Ask closed", async ({
  page,
}) => {
  await using run = await savedRun("e2e-voice-open");
  await playing(page, run.lessonId);
  expect(await starts(page)).toEqual(["webrtc"]);
  expect(await page.evaluate(() => window.__qaFake?.textOnly)).toBe(false);
  await expect(panel(page)).toHaveAttribute("data-open", "false");
  await expect(
    page.getByRole("button", { name: "Mute the mic" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("speaking stops the narration at once, the question is answered, and 'carry on' goes on", async ({
  page,
}) => {
  await using run = await savedRun("e2e-voice-barge");
  await playing(page, run.lessonId);
  await say(page, "What is this?");
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  expect(await audioPaused(page)).toBe(true);
  await expect(answer(page)).toContainText("row times a column");
  // The agent was told where the learner stopped.
  expect(
    await page.evaluate(() => window.__qaFake?.contextUpdates.at(-1)),
  ).toContain("(current step)");

  await say(page, "ok, carry on");
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  expect(await audioPaused(page)).toBe(false);
  // The same session the whole time, listening again.
  expect(await starts(page)).toEqual(["webrtc"]);
  await expect(listening(page)).toHaveText("Listening");
});

test("spoken commands: skip ahead, say that again, go to a step then carry on", async ({
  page,
}) => {
  await using run = await savedRun("e2e-voice-commands", { steps: 3 });
  await playing(page, run.lessonId);

  await say(page, "skip ahead");
  await expect(player(page)).toHaveAttribute("data-step", "1");
  await expect(player(page)).toHaveAttribute("data-state", "playing");

  await page
    .getByTestId("player-audio")
    .evaluate((a: HTMLAudioElement) => (a.currentTime = 4));
  await say(page, "say that again");
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await expect
    .poll(() =>
      page
        .getByTestId("player-audio")
        .evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeLessThan(2);

  await say(page, "go to step 3");
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  await say(page, "carry on");
  await expect(player(page)).toHaveAttribute("data-step", "2");
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  const calls = await page.evaluate(() =>
    window.__qaFake?.toolCalls.map((c) => c.name),
  );
  expect(calls).toEqual([
    "next_step",
    "replay_step",
    "go_to_step",
    "resume_lesson",
  ]);
});

test("'hold on' keeps the lesson held; 'go back' starts the step before", async ({
  page,
}) => {
  await using run = await savedRun("e2e-voice-hold", { steps: 3 });
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await expect(listening(page)).toHaveText("Listening");
  await say(page, "next step please");
  await expect(player(page)).toHaveAttribute("data-step", "1");
  await expect(player(page)).toHaveAttribute("data-state", "playing");

  // Speaking opens Ask (barge-in), which already holds the lesson; pause_lesson while asking
  // with no answer view does nothing, so Ask stays open and the lesson stays held.
  await say(page, "hold on");
  await expect
    .poll(() =>
      page.evaluate(() => window.__qaFake?.toolCalls.map((c) => c.name)),
    )
    .toContain("pause_lesson");
  await page.waitForTimeout(300);
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  expect(await audioPaused(page)).toBe(true);

  await say(page, "go back");
  await expect(player(page)).toHaveAttribute("data-step", "0");
  await expect(player(page)).toHaveAttribute("data-state", "playing");
});

test("muted: speaking doesn't stop the narration; unmuted, it does", async ({
  page,
}) => {
  await using run = await savedRun("e2e-voice-mute");
  await playing(page, run.lessonId);
  await page.getByRole("button", { name: "Mute the mic" }).click();
  await expect(listening(page)).toHaveText("Mic muted");
  expect(await page.evaluate(() => window.__qaFake?.micMuted)).toBe(true);
  await say(page, "What is this?");
  await page.waitForTimeout(300);
  await expect(player(page)).toHaveAttribute("data-state", "playing");

  await page.getByRole("button", { name: "Unmute the mic" }).click();
  await expect(listening(page)).toHaveText("Listening");
  await say(page, "What is this?");
  await expect(player(page)).toHaveAttribute("data-state", "asking");
});

test("the narration leaking into the mic (low VAD scores) doesn't stop it", async ({
  page,
}) => {
  await using run = await savedRun("e2e-voice-echo");
  await playing(page, run.lessonId);
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.__qaFake?.vad(0.6));
    await page.waitForTimeout(50);
  }
  await expect(player(page)).toHaveAttribute("data-state", "playing");
});

test(`mic denied: no voice session, and typed questions work exactly as before`, async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as { __qaFakeMicDenied?: boolean }).__qaFakeMicDenied = true;
  });
  await using run = await savedRun("e2e-voice-denied");
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await page.waitForTimeout(300);
  expect(await starts(page)).toEqual([]);
  await expect(listening(page)).toHaveCount(0);
  // Ask by voice, as before: the mic is refused, so it's a text-only session (section 7).
  await askByKey(page);
  await expect(page.getByTestId("ask-notice")).toHaveText(
    "Mic is off. Type your question; the answer will appear as text.",
  );
  await askQuestion(page, "What is this?");
  await expect(answer(page)).toContainText("row times a column");
  expect(await page.evaluate(() => window.__qaFake?.textOnly)).toBe(true);
});

test("the voice session drops with Ask closed: no message, the lesson goes on, it reopens", async ({
  page,
}) => {
  await using run = await savedRun("e2e-voice-drop");
  await playing(page, run.lessonId);
  await page.evaluate(() => window.__qaFake?.drop());
  await expect(listening(page)).toHaveCount(0);
  await expect(page.getByTestId("ask-notice")).toHaveCount(0);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await expect(listening(page)).toHaveText("Listening", { timeout: 6000 });
  expect(await starts(page)).toEqual(["webrtc", "webrtc"]);
});

test("after a typed question, a spoken command still works: the mic is off only while typing", async ({
  page,
}) => {
  await using run = await savedRun("e2e-voice-typed");
  await playing(page, run.lessonId);
  const micMuted = () => page.evaluate(() => window.__qaFake?.micMuted);
  await askInput(page).fill("What is this?");
  await expect.poll(micMuted).toBe(true);
  await askInput(page).press("Enter");
  await expect(answer(page)).toContainText("row times a column");
  // The input still has focus, but the draft is gone: the mic is back.
  await expect(askInput(page)).toBeFocused();
  await expect.poll(micMuted).toBe(false);
  expect(await page.evaluate(() => window.__qaFake?.textOnly)).toBe(false);

  await say(page, "ok, carry on");
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  // The same voice session the whole time, listening again.
  expect(await starts(page)).toEqual(["webrtc"]);
  await expect(listening(page)).toHaveText("Listening");
});

test("'hold on' while asking with a sketch in flight (no Answer view): Ask, the answer and the sketch are kept", async ({
  page,
}) => {
  // The agent once called pause_lesson by itself mid-answer, which closed Ask and dropped the
  // sketch (board comment 6887751495). Closing Ask from the Answer view (#94) is unit-tested
  // (tests/unit/app/lesson/lessonVoice.test.ts).
  await using run = await savedRun("e2e-voice-pause-asking");
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/sketch", async (route) => {
    await gate;
    await route.fulfill({
      json: {
        sketch: {
          objects: [
            {
              kind: "text",
              id: "note",
              x: 800,
              y: 700,
              text: "row times column",
            },
          ],
          actions: [],
        },
      },
    });
  });
  await playing(page, run.lessonId);
  const request = page.waitForRequest("**/api/sketch");
  // draw_scene waits for the sketch (#90), so this turn only ends after release().
  const drawTurn = say(page, "can you draw it?");
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  await request;
  await expect(answer(page)).toContainText("Let me sketch that");

  await say(page, "hold on");
  await expect
    .poll(() =>
      page.evaluate(() => window.__qaFake?.toolCalls.map((c) => c.name)),
    )
    .toContain("pause_lesson");
  await page.waitForTimeout(300);
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  await expect(panel(page)).toHaveAttribute("data-open", "true");

  release();
  await drawTurn;
  const note = page
    .getByTestId("whiteboard")
    .locator('[data-object-id="note"]');
  await expect(note).toHaveCount(1);
  await expect(player(page)).toHaveAttribute("data-state", "asking");
});
