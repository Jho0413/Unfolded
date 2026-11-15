// The tutor UI on the lesson page (ARCHITECTURE.md section 5.6): the card instead of a
// transport, the always-visible Ask box (typed before any mic answer), the answer's tag and
// a drawn answer's Answer view, carry on, captions, the outline, the keys, and the
// theme toggle. Saved runs come from ./support/savedRun.ts; the conversation is the scripted
// fake (NEXT_PUBLIC_FAKE_APIS=1); /api/sketch is faked per test. Screenshots at 1440 x 900, in
// dark and light, go to evidence/lesson-tutor-ui/ (gitignored).
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { CARD_STATUS, CARD_TEXT } from "@/player/cardView";
import { savedRun, savedStepTitle } from "./support/savedRun";
import {
  answer,
  askInput,
  askQuestion,
  card,
  cardButton,
  carryOn,
  goOn,
  holdOn,
  nextIdea,
  sayAgain,
} from "./support/tutor";
import { lessonOf, narratedReply } from "./support/answer";

test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

const EVIDENCE = path.join(process.cwd(), "evidence", "lesson-tutor-ui");
async function screenshot(page: Page, name: string) {
  await mkdir(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, `${name}.png`) });
}

const player = (page: Page) => page.getByTestId("player");
const board = (page: Page) => page.getByTestId("whiteboard");
const status = (page: Page) => page.getByTestId("card-status");

async function expectState(page: Page, state: string, step: number) {
  await expect(player(page)).toHaveAttribute("data-state", state);
  await expect(player(page)).toHaveAttribute("data-step", String(step));
}

/** Seeks the step's audio and waits for the seek to land. */
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

/**
 * Waits until the step's audio is really playing: a finite duration (before the metadata loads
 * it is NaN), data buffered, and the clock moving. The machine says "playing" as soon as play()
 * is called, before the element starts; seeking before then can leave the element short of its
 * end, never "ended" (the flaky "keys" test).
 */
async function audioRunning(page: Page) {
  await expect
    .poll(() =>
      page
        .getByTestId("player-audio")
        .evaluate(
          (a: HTMLAudioElement) =>
            Number.isFinite(a.duration) &&
            !a.paused &&
            a.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA &&
            a.currentTime > 0,
        ),
    )
    .toBe(true);
}

/** Waits until the audio element itself has paused (its "pause" event follows the machine's). */
async function audioPaused(page: Page) {
  await expect
    .poll(() =>
      page
        .getByTestId("player-audio")
        .evaluate((a: HTMLAudioElement) => a.paused),
    )
    .toBe(true);
}

/** Plays the step on screen to its end: once its audio runs, seek just before the end. */
async function endStep(page: Page, step: number) {
  const audio = page.getByTestId("player-audio");
  await audioRunning(page);
  await audio.evaluate((a: HTMLAudioElement) => {
    a.currentTime = Math.max(0, a.duration - 0.1);
  });
  await expectState(page, "stepEnded", step);
}

const answerView = (page: Page) => page.getByTestId("answer-view");

/** A drawn answer, laid out from the answer template (it names only its own objects). */
const SKETCH = {
  narration: "[[c]]Here it is.",
  objects: [
    { kind: "text", id: "title", x: 800, y: 110, text: "Row times column" },
    {
      kind: "matrix",
      id: "row",
      x: 400,
      y: 420,
      rows: [["1", "2"]],
      label: "row",
    },
    {
      kind: "matrix",
      id: "col",
      x: 1000,
      y: 396,
      rows: [["5"], ["7"]],
      label: "column",
    },
    {
      kind: "arrow",
      id: "times",
      from: { id: "row" },
      to: { id: "col" },
      label: "times",
    },
    {
      kind: "text",
      id: "sum",
      x: 800,
      y: 810,
      text: "1·5 + 2·7 = 19",
      size: "s",
    },
  ],
  actions: [{ do: "highlight", target: { id: "row", row: 0 }, cue: "c" }],
};

test("no transport: Hold on → Holding on → Go on → the step ends → Next: <title> → step 2", async ({
  page,
}) => {
  await using run = await savedRun("e2e-tutor-flow");
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  await expect(status(page)).toHaveText(CARD_STATUS.explaining);
  // No play button, scrubber or timecode anywhere.
  for (const name of ["Play", "Pause", "Replay", "Back"])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  await expect(page.getByRole("slider")).toHaveCount(0);
  await expect(page.getByText("Idea 1 of 2")).toBeVisible();

  await holdOn(page).click();
  await expectState(page, "paused", 0);
  await expect(status(page)).toHaveText(CARD_STATUS.holding);
  await goOn(page).click();
  await expectState(page, "playing", 0);

  await endStep(page, 0);
  await expect(card(page)).toContainText(CARD_TEXT.ideaEnded);
  await expect(nextIdea(page)).toHaveText(CARD_TEXT.next(savedStepTitle(1)));
  await nextIdea(page).click();
  await expectState(page, "playing", 1);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(
    savedStepTitle(1),
  );
});

test("the last step's end: the whole lesson, Say that again replays it", async ({
  page,
}) => {
  await using run = await savedRun("e2e-tutor-last", { steps: 1 });
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  await endStep(page, 0);
  await expect(card(page)).toContainText(CARD_TEXT.lessonEnded);
  await expect(nextIdea(page)).toHaveCount(0);
  await sayAgain(page).click();
  await expectState(page, "playing", 0);
});

test("keys: Space holds on and goes on, → next idea, ← back, R again", async ({
  page,
}) => {
  await using run = await savedRun("e2e-tutor-keys");
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  await audioRunning(page);
  await page.keyboard.press("Space");
  await expectState(page, "paused", 0);
  // Go on only once the element has paused too: a second Space before its "pause" event fires
  // lets that late event pause the machine again, and play and pause then chase each other.
  await audioPaused(page);
  await page.keyboard.press("Space");
  await expectState(page, "playing", 0);
  await endStep(page, 0);
  await page.keyboard.press("ArrowRight");
  await expectState(page, "playing", 1);
  await seek(page, 5);
  await page.keyboard.press("r");
  await expect
    .poll(() =>
      page
        .getByTestId("player-audio")
        .evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeLessThan(2);
  await page.keyboard.press("ArrowLeft");
  await expectState(page, "playing", 0);
  // Typing in the Ask box never moves the lesson.
  await askInput(page).click();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("r");
  await expectState(page, "playing", 0);
  await expect(askInput(page)).toHaveValue("r");
});

test("the outline: done, current, and a row goes to its step", async ({
  page,
}) => {
  await using run = await savedRun("e2e-tutor-outline", { steps: 3 });
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  const rows = page.getByTestId("outline-step");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute("aria-current", "step");
  await expect(rows.nth(0)).toBeDisabled();
  // Step 2 was prefetched once step 1 was on screen; step 3 was never asked for.
  await expect(rows.nth(1)).toHaveAttribute("data-fetch", "ready");
  await expect(rows.nth(2)).toHaveAttribute("data-fetch", "notStarted");
  await expect(rows.nth(2)).toContainText("Not ready");
  await rows.nth(2).click();
  await expectState(page, "playing", 2);
  await expect(rows.nth(0)).toHaveAttribute("data-place", "done");
  await expect(rows.nth(1)).toHaveAttribute("data-place", "done");
  await expect(rows.nth(2)).toHaveAttribute("aria-current", "step");
});

test("captions: the sentence being said, with the said part apart; the toggle hides it", async ({
  page,
}) => {
  await using run = await savedRun("e2e-tutor-captions");
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  await holdOn(page).click();
  await seek(page, 0);
  const caption = page.getByTestId("caption");
  await expect(caption).toBeVisible();
  const first = await caption.textContent();
  expect(first?.length).toBeGreaterThan(0);
  await seek(page, 6);
  await expect(caption).not.toHaveText(first ?? "");
  const toggle = page.getByRole("button", { name: "Captions" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(caption).toHaveCount(0);
  await expect(toggle).toHaveText("Captions");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

test("a typed question before any mic answer opens Ask and is answered as text", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as { __qaFakeMicPending?: boolean }).__qaFakeMicPending = true;
  });
  await using run = await savedRun("e2e-tutor-typed-first");
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  // The box works before Ask is open: no mic, no session yet.
  await expect(askInput(page)).toBeEnabled();
  expect(await page.evaluate(() => window.__qaFake?.starts.length ?? 0)).toBe(
    0,
  );
  await askQuestion(page, "What is this?");
  await expectState(page, "asking", 0);
  const panel = page.getByTestId("ask-panel");
  await expect(panel).toHaveAttribute("data-phase", "connected");
  await expect(panel).toHaveAttribute("data-text-only", "true");
  await expect(page.getByTestId("ask-question")).toHaveText(
    "You asked: What is this?",
  );
  await expect(answer(page)).toContainText("row times a column");
  await expect(status(page)).toHaveText(CARD_STATUS.answering);
  // No transcript: only the latest question and answer.
  await expect(page.getByTestId("ask-transcript")).toHaveCount(0);
  await askQuestion(page, "And why?");
  await expect(page.getByTestId("ask-question")).toHaveText(
    "You asked: And why?",
  );
  await expect(page.getByTestId("ask-question")).toHaveCount(1);
});

test("a spoken answer: Spoken answer, and the lesson stays on the board", async ({
  page,
}) => {
  await using run = await savedRun("e2e-tutor-spoken");
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  await askQuestion(page, "why does that work?");
  await expect(answer(page)).toContainText("row times a column");
  await expect(page.getByTestId("answer-tag")).toHaveText(CARD_TEXT.tagSpoken);
  await expect(page.getByTestId("answer-tag")).toHaveAttribute(
    "data-tag",
    "spoken",
  );
  await expect(answerView(page)).toHaveCount(0);
});

test("a highlight answer (#91): Pointing at the board, the highlight on the lesson's board; the next spoken answer is Spoken answer", async ({
  page,
}) => {
  await using run = await savedRun("e2e-tutor-pointing");
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  // The fake agent highlights the first row of the first object it was told about.
  await askQuestion(page, "show me the first row");
  await expect(answer(page)).toContainText("first row");
  await expect(page.getByTestId("answer-tag")).toHaveText(
    CARD_TEXT.tagPointingBoard,
  );
  await expect(page.getByTestId("answer-tag")).toHaveAttribute(
    "data-tag",
    "board",
  );
  // The highlight landed on the lesson's board (full-flow.spec.ts checks the cells).
  expect(
    await page.evaluate(() =>
      window.__qaFake?.toolCalls.map((c) => `${c.name} -> ${c.result}`),
    ),
  ).toContain("highlight -> ok");
  await expect(answerView(page)).toHaveCount(0);

  // The tag is the latest answer's: a question answered in words only is spoken.
  await askQuestion(page, "and why?");
  await expect(page.getByTestId("ask-question")).toHaveText(
    "You asked: and why?",
  );
  await expect(page.getByTestId("answer-tag")).toHaveText(CARD_TEXT.tagSpoken);
});

test("a draw_scene answer: Drawing on the board, in the Answer view instead of the lesson", async ({
  page,
}) => {
  await page.route("**/api/sketch", (route) =>
    route.fulfill({ json: narratedReply(lessonOf(route), SKETCH) }),
  );
  await using run = await savedRun("e2e-tutor-drawn");
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  await askQuestion(page, "can you draw it?");
  await expect(page.getByTestId("answer-tag")).toHaveText(CARD_TEXT.tagDrawing);
  await expect(answerView(page)).toBeVisible();
  await expect(board(page).locator('[data-object-id="title"]')).toHaveCount(1);
});

test("a draw_scene sketch that fails: Couldn't draw that, tagged Spoken answer, the lesson stays", async ({
  page,
}) => {
  await page.route("**/api/sketch", (route) =>
    route.fulfill({ status: 502, json: { error: "Couldn't draw that." } }),
  );
  await using run = await savedRun("e2e-tutor-draw-failed");
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  await askQuestion(page, "can you draw it?");
  await expect(page.getByTestId("ask-tool-notice")).toHaveText(
    "Couldn't draw that.",
  );
  await expect(page.getByTestId("answer-tag")).toHaveText(CARD_TEXT.tagSpoken);
  await expect(answerView(page)).toHaveCount(0);
});

test("Got it, carry on: a lesson stopped mid-step resumes", async ({
  page,
}) => {
  await using run = await savedRun("e2e-tutor-carry-on");
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  await askQuestion(page, "What is this?");
  await expect(answer(page)).toBeVisible();
  await carryOn(page).click();
  await expectState(page, "playing", 0);
  await expect(answerView(page)).toHaveCount(0);
});

test("Hold on → ask → Got it, carry on: resumes", async ({ page }) => {
  await using run = await savedRun("e2e-tutor-held-carry-on");
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  await holdOn(page).click();
  await expectState(page, "paused", 0);
  await askQuestion(page, "What is this?");
  await expect(answer(page)).toBeVisible();
  await carryOn(page).click();
  await expectState(page, "playing", 0);
});

test("Hold on → ask → Escape: stays held", async ({ page }) => {
  await using run = await savedRun("e2e-tutor-held-escape");
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  await holdOn(page).click();
  await expectState(page, "paused", 0);
  await askQuestion(page, "What is this?");
  await expect(answer(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expectState(page, "paused", 0);
  await expect(goOn(page)).toBeVisible();
});

test("explaining → ask → Escape: resumes", async ({ page }) => {
  await using run = await savedRun("e2e-tutor-explaining-escape");
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  await page.keyboard.press("a");
  await expectState(page, "asking", 0);
  await expect(page.getByTestId("ask-panel")).toHaveAttribute(
    "data-phase",
    "connected",
  );
  await page.keyboard.press("Escape");
  await expectState(page, "playing", 0);
});

test("A with a modifier, or held down, doesn't open Ask", async ({ page }) => {
  await using run = await savedRun("e2e-tutor-a-modified");
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  await page.keyboard.press("Shift+A");
  await page.keyboard.press("Control+a");
  await expectState(page, "playing", 0);
});

test("the mic prompt is open (Ask by A): a typed question is sent and answered", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as { __qaFakeMicPending?: boolean }).__qaFakeMicPending = true;
  });
  await using run = await savedRun("e2e-tutor-mic-pending");
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  await page.keyboard.press("a");
  const panel = page.getByTestId("ask-panel");
  await expect(panel).toHaveAttribute("data-phase", "waiting");
  await expect(page.getByTestId("ask-hint")).toBeVisible();
  await askQuestion(page, "What is this?");
  await expect(panel).toHaveAttribute("data-phase", "connected");
  await expect(panel).toHaveAttribute("data-text-only", "true");
  await expect(answer(page)).toContainText("row times a column");
});

test("the mic prompt is open (Ask by Enter): the box keeps focus, and the next question is answered too", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as { __qaFakeMicPending?: boolean }).__qaFakeMicPending = true;
  });
  await using run = await savedRun("e2e-tutor-mic-pending-twice");
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  await askInput(page).click();
  await page.keyboard.type("What is this?");
  await page.keyboard.press("Enter");
  await expectState(page, "asking", 0);
  await expect(askInput(page)).toBeFocused();
  // Typed straight on, with no click: nothing is lost while the session starts.
  await page.keyboard.type("Why a row?");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ask-question")).toHaveText(
    "You asked: Why a row?",
  );
  await expect(answer(page)).toContainText("row times a column");
  expect(
    await page.evaluate(() =>
      window.__qaFake?.transcript
        .filter((m) => m.role === "user")
        .map((m) => m.text),
    ),
  ).toEqual(["What is this?", "Why a row?"]);
});

test("Got it, carry on after the step ended: back to its end-of-step prompt", async ({
  page,
}) => {
  await using run = await savedRun("e2e-tutor-carry-on-ended");
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  await endStep(page, 0);
  await askQuestion(page, "What is this?");
  await expect(answer(page)).toBeVisible();
  await carryOn(page).click();
  await expectState(page, "stepEnded", 0);
  await expect(nextIdea(page)).toBeVisible();
});

test("the theme toggle flips data-theme, and the choice survives a reload", async ({
  page,
}) => {
  await using run = await savedRun("e2e-tutor-theme");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`/lesson/${run.lessonId}`);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.getByTestId("theme-toggle").click();
  await expect(html).toHaveAttribute("data-theme", "light");
  // The board follows: its background is the light board colour.
  await expect
    .poll(() =>
      board(page)
        .locator("rect")
        .first()
        .evaluate((r) => getComputedStyle(r).fill),
    )
    .toBe("rgb(255, 255, 255)");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.getByTestId("theme-toggle").click();
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
});

test("the system's theme with nothing saved: light when it prefers light", async ({
  page,
}) => {
  await using run = await savedRun("e2e-tutor-theme-system");
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

for (const theme of ["dark", "light"] as const) {
  test(`evidence: the tutor at 1440 x 900, ${theme}`, async ({ page }) => {
    await page.route("**/api/sketch", (route) =>
      route.fulfill({ json: narratedReply(lessonOf(route), SKETCH) }),
    );
    await using run = await savedRun(`e2e-tutor-shots-${theme}`, {
      steps: 3,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`/lesson/${run.lessonId}`);
    await expectState(page, "playing", 0);
    await holdOn(page).click();
    await seek(page, 3.2);
    await goOn(page).click();
    await expectState(page, "playing", 0);
    await expect(page.getByTestId("caption")).toBeVisible();
    await screenshot(page, `${theme}-1-explaining`);
    await askQuestion(page, "can you draw it?");
    await expect(answerView(page)).toBeVisible();
    await expect(page.getByTestId("answer-tag")).toHaveText(
      CARD_TEXT.tagDrawing,
    );
    await screenshot(page, `${theme}-2-drawn-answer`);
    await carryOn(page).click();
    await endStep(page, 0);
    await screenshot(page, `${theme}-3-step-ended`);
  });
}

/** As player-autoplay.spec.ts: play() needs a trusted gesture (a reload's blocked autoplay). */
function blockAutoplay(page: Page) {
  return page.addInitScript(() => {
    let gesture = false;
    for (const type of ["pointerdown", "keydown"])
      window.addEventListener(
        type,
        (e) => {
          if (e.isTrusted) gesture = true;
        },
        { capture: true },
      );
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!gesture)
        return Promise.reject(
          new DOMException("play() needs a user gesture", "NotAllowedError"),
        );
      return play.call(this);
    };
  });
}

test("preparing, then autoplay blocked: the intro names the lesson, and Start with “<title>” plays it", async ({
  page,
}) => {
  await blockAutoplay(page);
  await using run = await savedRun("e2e-tutor-start", { steps: 3 });
  // Hold step 0 for a moment, to see the preparing state.
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route(`**/api/lessons/${run.lessonId}/steps/0`, async (route) => {
    await gate;
    await route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "loading", 0);
  await expect(status(page)).toHaveText(CARD_STATUS.preparing);
  await expect(page.getByTestId("card-wait")).toHaveText(
    CARD_TEXT.preparing(savedStepTitle(0)),
  );
  await expect(page.getByTestId("board-preparing")).toBeVisible();
  await expect(page.getByTestId("outline-step").first()).toHaveAttribute(
    "data-fetch",
    "generating",
  );
  await screenshot(page, "dark-0-preparing");
  release();
  await expectState(page, "paused", 0);
  await expect(status(page)).toHaveText(CARD_STATUS.ready);
  await expect(page.getByTestId("card-said")).toHaveText(
    "3 ideas from Matrix multiplication. I'll draw as I explain. Interrupt me any time.",
  );
  await screenshot(page, "dark-0-start");
  await cardButton(page, CARD_TEXT.start(savedStepTitle(0))).click();
  await expectState(page, "playing", 0);
});
