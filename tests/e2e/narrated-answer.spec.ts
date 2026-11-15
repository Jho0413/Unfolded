// Narrated answers (#105, ARCHITECTURE.md sections 5.6 and 8): a drawn answer plays like a lesson
// step, each part on its cue as the narration is spoken. The browser rows of #105's table, with
// the fake conversation (NEXT_PUBLIC_FAKE_APIS=1; its say(text) is the learner speaking), a saved
// run (./support/savedRun.ts), and /api/sketch and the answer's audio faked per test
// (./support/answer.ts). The pure rows are in tests/unit/app/lesson/AnswerViewPlayback.test.ts.
import { expect, type Page, test } from "@playwright/test";
import { answerShownResult } from "@/qa/drawScene";
import { CARD_TEXT } from "@/player/cardView";
import { fakeAnswerAudio, lessonOf, narratedReply } from "./support/answer";
import { savedRun } from "./support/savedRun";
import { card, carryOn } from "./support/tutor";
import type { Signal } from "@/shared/lesson";

test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

const player = (page: Page) => page.getByTestId("player");
const answerView = (page: Page) => page.getByTestId("answer-view");
const object = (page: Page, id: string) =>
  page.getByTestId("whiteboard").locator(`[data-object-id="${id}"]`);
const visible = (page: Page, id: string) =>
  object(page, id).getAttribute("data-visible");
const say = (page: Page, text: string) =>
  page.evaluate((t) => window.__qaFake?.say(t), text);
/** What the fake agent heard back from each draw_scene call. */
const drawResults = (page: Page) =>
  page.evaluate(
    () =>
      window.__qaFake?.toolCalls
        .filter((c) => c.name === "draw_scene")
        .map((c) => c.result) ?? [],
  );

/** The answer's cues: "first" shows early, "second" well after (the audio is longer still). */
const CUES = { first: 300, second: 3000 };
const AUDIO_MS = 5000;
const NARRATION =
  "Take [[first]]the first part, and after a pause [[second]]the second part.";
const SKETCH = {
  narration: NARRATION,
  objects: [
    { kind: "text", id: "title", x: 800, y: 110, text: "Two parts" },
    { kind: "text", id: "p1", x: 500, y: 450, text: "first", hidden: true },
    { kind: "text", id: "p2", x: 1100, y: 450, text: "second", hidden: true },
  ],
  actions: [
    { do: "show", target: { id: "p1" }, cue: "first" },
    { do: "show", target: { id: "p2" }, cue: "second" },
  ],
};

/** Serves the answer once `release` is called (it's "preparing" until then). */
async function gatedAnswer(page: Page) {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/sketch", async (route) => {
    await gate;
    await route.fulfill({ json: narratedReply(lessonOf(route), SKETCH, CUES) });
  });
  return () => release();
}

/** The lesson plays with its voice session listening; the learner asks for a drawing. */
async function askForDrawing(page: Page, lessonId: string) {
  await page.goto(`/lesson/${lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await expect(page.getByTestId("ask-listening")).toHaveText("Listening");
  // Not awaited: the draw turn only ends when draw_scene resolves.
  void say(page, "can you draw it?");
  await expect(player(page)).toHaveAttribute("data-state", "asking");
}

test("none x draw_scene: Sketching… and nothing drawn; then the parts appear on their cues, in order, and draw_scene resolves Shown", async ({
  page,
}) => {
  await using run = await savedRun("e2e-narrated-cues");
  await fakeAnswerAudio(page, AUDIO_MS);
  const release = await gatedAnswer(page);
  await askForDrawing(page, run.lessonId);
  await expect(page.getByTestId("card-wait")).toHaveText(CARD_TEXT.sketching);
  await expect(answerView(page)).toHaveCount(0);

  release();
  await expect(answerView(page)).toBeVisible();
  await expect(page.getByTestId("card-wait")).toHaveCount(0);
  // The first part on its cue, while the second is still to come.
  await expect.poll(() => visible(page, "p1")).toBe("true");
  expect(await visible(page, "p2")).toBe("false");
  await page.screenshot({ path: "evidence/105/e2e-first-cue.png" });
  // The second on its own cue, a few seconds later.
  await expect
    .poll(() => visible(page, "p2"), { timeout: CUES.second + 3000 })
    .toBe("true");
  // The narration ends: the drawing stays complete, and the agent hears what was said.
  await expect
    .poll(() => drawResults(page), { timeout: AUDIO_MS + 3000 })
    .toEqual([answerShownResult(NARRATION)]);
  expect(await visible(page, "p1")).toBe("true");
  expect(await visible(page, "p2")).toBe("true");
  await page.screenshot({ path: "evidence/105/e2e-done.png" });
});

test("playing x the learner speaks: the narration stops and the drawing holds; carry on goes on from the same moment", async ({
  page,
}) => {
  await using run = await savedRun("e2e-narrated-barge");
  await fakeAnswerAudio(page, AUDIO_MS);
  const release = await gatedAnswer(page);
  await askForDrawing(page, run.lessonId);
  release();
  await expect.poll(() => visible(page, "p1")).toBe("true");

  await say(page, "why is that?");
  // draw_scene resolves at the barge-in, with what the learner had heard.
  await expect
    .poll(() => drawResults(page))
    .toEqual([expect.stringMatching(/^Paused after: Take the first part/)]);
  // Held past the second cue: the drawing doesn't move on.
  await page.waitForTimeout(CUES.second + 500);
  expect(await visible(page, "p2")).toBe("false");
  await expect(player(page)).toHaveAttribute("data-state", "asking");

  await say(page, "ok, carry on");
  // The agent says nothing after a command (#138): the card says what it did, not
  // "Thinking…" forever (QA A8).
  await expect(card(page)).toContainText(CARD_TEXT.commanded.resume);
  await expect(card(page)).not.toContainText(CARD_TEXT.thinking);
  // The answer goes on (not the lesson): Ask stays open and the second part arrives.
  await expect
    .poll(() => visible(page, "p2"), { timeout: CUES.second + 3000 })
    .toBe("true");
  await expect(answerView(page)).toBeVisible();
  await expect(player(page)).toHaveAttribute("data-state", "asking");
});

test("done x say that again: from 0, the drawing reset; then carry on closes Ask and the lesson goes on", async ({
  page,
}) => {
  await using run = await savedRun("e2e-narrated-again");
  await fakeAnswerAudio(page, 1500);
  await page.route("**/api/sketch", (route) =>
    route.fulfill({
      json: narratedReply(lessonOf(route), SKETCH, { first: 300, second: 900 }),
    }),
  );
  await askForDrawing(page, run.lessonId);
  await expect
    .poll(() => drawResults(page), { timeout: 6000 })
    .toEqual([answerShownResult(NARRATION)]);

  await say(page, "say that again");
  await expect(card(page)).toContainText(CARD_TEXT.commanded.replay);
  await expect(card(page)).not.toContainText(CARD_TEXT.thinking);
  // From the start: the parts are hidden again, then come back on their cues.
  await expect.poll(() => visible(page, "p2")).toBe("false");
  await expect.poll(() => visible(page, "p2"), { timeout: 4000 }).toBe("true");
  await expect(answerView(page)).toBeVisible();

  // Over again: "carry on" is the lesson's now.
  await page.waitForTimeout(1000);
  await say(page, "ok, carry on");
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await expect(answerView(page)).toHaveCount(0);
});

test("audio fails to load: the whole drawing at once (degrade, don't fail), and draw_scene resolves Shown", async ({
  page,
}) => {
  await using run = await savedRun("e2e-narrated-no-audio");
  await fakeAnswerAudio(page, 0, 404);
  await page.route("**/api/sketch", (route) =>
    route.fulfill({ json: narratedReply(lessonOf(route), SKETCH, CUES) }),
  );
  await askForDrawing(page, run.lessonId);
  await expect(answerView(page)).toBeVisible();
  // Both parts at once, long before the second cue's time.
  await expect.poll(() => visible(page, "p2"), { timeout: 1500 }).toBe("true");
  expect(await visible(page, "p1")).toBe("true");
  await expect
    .poll(() => drawResults(page))
    .toEqual([answerShownResult(NARRATION)]);
  await expect(page.getByTestId("ask-tool-notice")).toHaveCount(0);
});

test("generation fails: Couldn't draw that, nothing drawn, and the agent answers in words", async ({
  page,
}) => {
  await using run = await savedRun("e2e-narrated-failed");
  await page.route("**/api/sketch", (route) =>
    route.fulfill({ status: 502, json: { error: "Couldn't draw that." } }),
  );
  await askForDrawing(page, run.lessonId);
  await expect(page.getByTestId("ask-tool-notice")).toHaveText(
    "Couldn't draw that.",
  );
  await expect(answerView(page)).toHaveCount(0);
  await expect(page.getByText(CARD_TEXT.sketching)).toHaveCount(0);
  await expect
    .poll(() => drawResults(page))
    .toEqual([expect.stringContaining("Answer in words")]);
});

test("Ask closes while the answer plays (Got it, carry on): the narration stops and the lesson goes on", async ({
  page,
}) => {
  await using run = await savedRun("e2e-narrated-close");
  await fakeAnswerAudio(page, AUDIO_MS);
  await page.route("**/api/sketch", (route) =>
    route.fulfill({ json: narratedReply(lessonOf(route), SKETCH, CUES) }),
  );
  await askForDrawing(page, run.lessonId);
  await expect.poll(() => visible(page, "p1")).toBe("true");
  await page
    .getByTestId("tutor-card")
    .getByRole("button", { name: /carry on$/i })
    .click();
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await expect(answerView(page)).toHaveCount(0);
  await expect
    .poll(() => drawResults(page))
    .toEqual([expect.stringContaining("left this answer")]);
});

test("'wait' over a drawn answer only holds it: no question signal, and the recap lists no question (demo rehearsal)", async ({
  page,
}) => {
  await using run = await savedRun("e2e-narrated-hold-not-asked", {
    steps: 1,
  });
  const bodies: Signal[] = [];
  await page.route(`**/api/lessons/${run.lessonId}/signals`, async (route) => {
    bodies.push(route.request().postDataJSON() as Signal);
    await route.fulfill({ json: { version: 1 } });
  });
  await fakeAnswerAudio(page, AUDIO_MS);
  const release = await gatedAnswer(page);
  await askForDrawing(page, run.lessonId);
  release();
  await expect.poll(() => visible(page, "p1")).toBe("true");

  // As the real agent in the Answer view, the fake calls no tool for "wait".
  await say(page, "wait");
  await expect
    .poll(() => drawResults(page))
    .toEqual([expect.stringMatching(/^Paused after:/)]);
  await carryOn(page).click();
  await expect(player(page)).not.toHaveAttribute("data-state", "asking");
  // Only "can you draw it?" was a question; "wait" was never posted.
  await expect
    .poll(() => bodies.filter((b) => "question" in b))
    .toEqual([expect.objectContaining({ question: "can you draw it?" })]);

  // The lesson's end: the recap lists the real question only.
  await page.getByTestId("player-audio").evaluate((a: HTMLAudioElement) => {
    a.currentTime = Math.max(0, a.duration - 0.1);
  });
  const questions = page.getByTestId("recap-questions");
  await expect(questions).toContainText("can you draw it?");
  await expect(questions).not.toContainText("“wait”");
});
