// The player and its controls on /dev/player (ROADMAP P5), with the fake
// two-step lesson in app/dev/player/fakeLesson.ts. Each test is named after
// the ARCHITECTURE.md section 6.1 cell (state + event) it drives, and asserts
// on data-* attributes. Timing is checked by seeking the audio to a cue time
// + 50 ms, never by waiting. Blocked autoplay is in player-autoplay.spec.ts.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { M1_CUE_TIMES } from "@/app/dev/board/scenes";
import { FAKE_AUDIO_MS, FAKE_SERVER_ERROR } from "@/app/dev/player/fakeLesson";
import { MESSAGES } from "@/player/machine";

// Chromium's default autoplay policy sometimes blocks the first play in
// tests, so autoplay is allowed outright here.
test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

/** Just past a cue, so its action has started. */
const AFTER_CUE_MS = 50;

function player(page: Page): Locator {
  return page.getByTestId("player");
}

function control(page: Page, name: string): Locator {
  return page
    .getByRole("toolbar", { name: "Player controls" })
    .getByRole("button", { name, exact: true });
}

async function expectState(page: Page, state: string, step: number) {
  await expect(player(page)).toHaveAttribute("data-state", state);
  await expect(player(page)).toHaveAttribute("data-step", String(step));
}

async function seek(page: Page, ms: number) {
  await page
    .getByTestId("player-audio")
    .evaluate((audio: HTMLAudioElement, s) => {
      audio.currentTime = s;
    }, ms / 1000);
}

async function currentTimeMs(page: Page): Promise<number> {
  return page
    .getByTestId("player-audio")
    .evaluate((audio: HTMLAudioElement) => audio.currentTime * 1000);
}

/** Plays step `step` to its end: seek close to the end and let it finish. */
async function endStep(page: Page, step: number) {
  await seek(page, FAKE_AUDIO_MS - 100);
  await expectState(page, "stepEnded", step);
}

/** Opens the page and waits for step 0 to autoplay. */
async function open(page: Page, query = "") {
  await page.goto(`/dev/player${query}`);
  await expectState(page, "playing", 0);
}

/** Opens the page and plays on to step 1 (the second, last step). */
async function openStep1(page: Page, query = "") {
  await open(page, query);
  await endStep(page, 0);
  await control(page, "Next").click();
  await expectState(page, "playing", 1);
}

/** Asserts which controls are enabled; the others on screen are disabled. */
async function expectEnabled(page: Page, enabled: string[]) {
  for (const name of ["Back", "Replay", "Play", "Pause", "Next"]) {
    const button = control(page, name);
    if ((await button.count()) === 0) continue; // Play and Pause swap
    if (enabled.includes(name)) await expect(button).toBeEnabled();
    else await expect(button).toBeDisabled();
  }
}

function cell(page: Page, id: string, r: number, c: number): Locator {
  return page.locator(`[data-object-id="${id}"] [data-cell="${r},${c}"]`);
}

test.describe("controls", () => {
  test("loading + stepReady(k): → playing (autoplay)", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("heading", { level: 2 })).toContainText(
      "fake step 1",
    );
  });

  test("playing + pause: → paused", async ({ page }) => {
    await open(page);
    await control(page, "Pause").click();
    await expectState(page, "paused", 0);
    expect(
      await page
        .getByTestId("player-audio")
        .evaluate((a: HTMLAudioElement) => a.paused),
    ).toBe(true);
  });

  test("paused + resume: → playing", async ({ page }) => {
    await open(page);
    await control(page, "Pause").click();
    await control(page, "Play").click();
    await expectState(page, "playing", 0);
  });

  test("playing + pause (Space): → paused", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Space");
    await expectState(page, "paused", 0);
  });

  test("paused + resume (Space): → playing", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Space");
    await expectState(page, "paused", 0);
    await page.keyboard.press("Space");
    await expectState(page, "playing", 0);
  });

  test("playing + replay: seek to 0, stays playing", async ({ page }) => {
    await open(page);
    await seek(page, 5000);
    await control(page, "Replay").click();
    await expectState(page, "playing", 0);
    expect(await currentTimeMs(page)).toBeLessThan(1000);
  });

  test("paused + replay: seek to 0 → playing", async ({ page }) => {
    await open(page);
    await control(page, "Pause").click();
    await seek(page, 5000);
    await control(page, "Replay").click();
    await expectState(page, "playing", 0);
    expect(await currentTimeMs(page)).toBeLessThan(1000);
  });

  test("playing + next: ignored (Next only after the step ends)", async ({
    page,
  }) => {
    await open(page);
    await expect(control(page, "Next")).toBeDisabled();
  });

  test("playing + audioEnded: → stepEnded", async ({ page }) => {
    await open(page);
    await endStep(page, 0);
    await expect(control(page, "Next")).toBeEnabled();
  });

  test("stepEnded + replay: seek to 0 → playing", async ({ page }) => {
    await open(page);
    await endStep(page, 0);
    await control(page, "Replay").click();
    await expectState(page, "playing", 0);
    expect(await currentTimeMs(page)).toBeLessThan(1000);
  });

  test("stepEnded + next: → loading(next), then playing", async ({ page }) => {
    await open(page, "?delay=1500");
    await endStep(page, 0);
    await control(page, "Next").click();
    await expectState(page, "loading", 1);
    await expect(page.getByTestId("whiteboard")).toBeVisible();
    await expectState(page, "playing", 1);
    await expect(page.getByRole("heading", { level: 2 })).toContainText(
      "fake step 2",
    );
  });

  test("stepEnded + next on the last step: → finished", async ({ page }) => {
    await open(page);
    await endStep(page, 0);
    await control(page, "Next").click();
    await expectState(page, "playing", 1);
    await endStep(page, 1);
    await control(page, "Next").click();
    await expectState(page, "finished", 1);
    await expect(page.getByTestId("player-status")).toHaveText(
      MESSAGES.finished,
    );
  });

  test("finished + replay: seek to 0 → playing", async ({ page }) => {
    await open(page);
    await endStep(page, 0);
    await control(page, "Next").click();
    await expectState(page, "playing", 1);
    await endStep(page, 1);
    await control(page, "Next").click();
    await expectState(page, "finished", 1);
    await control(page, "Replay").click();
    await expectState(page, "playing", 1);
    expect(await currentTimeMs(page)).toBeLessThan(1000);
  });

  test("finished + back: → loading(last), then playing", async ({ page }) => {
    await open(page);
    await endStep(page, 0);
    await control(page, "Next").click();
    await expectState(page, "playing", 1);
    await endStep(page, 1);
    await control(page, "Next").click();
    await expectState(page, "finished", 1);
    await control(page, "Back").click();
    await expectState(page, "playing", 1);
    expect(await currentTimeMs(page)).toBeLessThan(1000);
  });

  test("playing + back: → loading(prev), then playing", async ({ page }) => {
    await openStep1(page);
    await control(page, "Back").click();
    await expectState(page, "playing", 0);
    expect(await currentTimeMs(page)).toBeLessThan(1000);
  });

  test("paused + back: → loading(prev), then playing", async ({ page }) => {
    await openStep1(page);
    await control(page, "Pause").click();
    await expectState(page, "paused", 1);
    await control(page, "Back").click();
    await expectState(page, "playing", 0);
  });

  test("stepEnded + back: → loading(prev), then playing", async ({ page }) => {
    await openStep1(page);
    await endStep(page, 1);
    await control(page, "Back").click();
    await expectState(page, "playing", 0);
  });

  test("playing + back on step 0: seek to 0, stays playing", async ({
    page,
  }) => {
    await open(page);
    await seek(page, 5000);
    await control(page, "Back").click();
    await expectState(page, "playing", 0);
    expect(await currentTimeMs(page)).toBeLessThan(1000);
  });

  test("paused + back on step 0: seek to 0 → playing", async ({ page }) => {
    await open(page);
    await control(page, "Pause").click();
    await seek(page, 5000);
    await control(page, "Back").click();
    await expectState(page, "playing", 0);
    expect(await currentTimeMs(page)).toBeLessThan(1000);
  });

  test("stepEnded + back on step 0: seek to 0 → playing", async ({ page }) => {
    await open(page);
    await endStep(page, 0);
    await control(page, "Back").click();
    await expectState(page, "playing", 0);
  });
});

test.describe("ignored controls are disabled", () => {
  test("loading: every control ignored", async ({ page }) => {
    await open(page, "?delay=1500");
    await endStep(page, 0);
    await control(page, "Next").click();
    await expectState(page, "loading", 1);
    await expectEnabled(page, []);
  });

  test("playing: next ignored", async ({ page }) => {
    await open(page);
    await expectEnabled(page, ["Back", "Replay", "Pause"]);
  });

  test("paused: next ignored", async ({ page }) => {
    await open(page);
    await control(page, "Pause").click();
    await expectEnabled(page, ["Back", "Replay", "Play"]);
  });

  test("stepEnded: resume (Play, Space) ignored", async ({ page }) => {
    await open(page);
    await endStep(page, 0);
    await expectEnabled(page, ["Back", "Replay", "Next"]);
    await page.keyboard.press("Space");
    await expectState(page, "stepEnded", 0);
  });

  test("finished: next and resume ignored", async ({ page }) => {
    await openStep1(page);
    await endStep(page, 1);
    await control(page, "Next").click();
    await expectState(page, "finished", 1);
    await expectEnabled(page, ["Back", "Replay"]);
  });
});

test.describe("play and pause from outside the page (media keys)", () => {
  test("playing + pause from outside: → paused", async ({ page }) => {
    await open(page);
    await page
      .getByTestId("player-audio")
      .evaluate((audio: HTMLAudioElement) => audio.pause());
    await expectState(page, "paused", 0);
  });

  test("paused + play from outside: → playing", async ({ page }) => {
    await open(page);
    await control(page, "Pause").click();
    await page
      .getByTestId("player-audio")
      .evaluate((audio: HTMLAudioElement) => audio.play());
    await expectState(page, "playing", 0);
  });

  test("stepEnded + play from outside: ignored, the audio stops again", async ({
    page,
  }) => {
    await open(page);
    await endStep(page, 0);
    // The player pauses it again, which rejects this play() with AbortError.
    await page
      .getByTestId("player-audio")
      .evaluate((audio: HTMLAudioElement) => audio.play().catch(() => {}));
    await expectState(page, "stepEnded", 0);
    await expect
      .poll(() =>
        page
          .getByTestId("player-audio")
          .evaluate((audio: HTMLAudioElement) => audio.paused),
      )
      .toBe(true);
  });
});

test.describe("failures", () => {
  test("loading + stepFailed(k): → failed with the server's message", async ({
    page,
  }) => {
    await open(page, "?fail=server");
    await endStep(page, 0);
    await control(page, "Next").click();
    await expectState(page, "failed", 1);
    await expect(page.getByTestId("player-error")).toHaveText(
      FAKE_SERVER_ERROR,
    );
  });

  test("loading + stepFailed(k), network down: → failed (Couldn't make this step. Retry?)", async ({
    page,
  }) => {
    await open(page, "?fail=network");
    await endStep(page, 0);
    await control(page, "Next").click();
    await expectState(page, "failed", 1);
    await expect(page.getByTestId("player-error")).toHaveText(
      MESSAGES.stepFailed,
    );
  });

  test("failed + retry: → loading(same), then playing", async ({ page }) => {
    await open(page, "?fail=server");
    await endStep(page, 0);
    await control(page, "Next").click();
    await expectState(page, "failed", 1);
    await control(page, "Retry").click();
    await expectState(page, "playing", 1);
    await expect(page.getByTestId("player-error")).toHaveCount(0);
  });

  test("failed + back: → loading(prev)", async ({ page }) => {
    await open(page, "?fail=server");
    await endStep(page, 0);
    await control(page, "Next").click();
    await expectState(page, "failed", 1);
    await control(page, "Back").click();
    await expectState(page, "playing", 0);
  });

  test("playing + audioError: → failed (Couldn't play the audio. Retry?)", async ({
    page,
  }) => {
    await page.goto("/dev/player?audio=broken");
    await expectState(page, "failed", 0);
    await expect(page.getByTestId("player-error")).toHaveText(
      MESSAGES.audioFailed,
    );
    await expect(control(page, "Retry")).toBeEnabled();
    // failed + back on step 0: ignored.
    await expect(control(page, "Back")).toBeDisabled();
  });

  test("audio fails to load: loading + stepFailed(k) → failed (Couldn't play the audio. Retry?)", async ({
    page,
  }) => {
    await page.goto("/dev/player?audio=missing");
    await expectState(page, "failed", 0);
    await expect(page.getByTestId("player-error")).toHaveText(
      MESSAGES.audioFailed,
    );
  });
});

test.describe("the board follows the audio clock", () => {
  test.beforeEach(async ({ page }) => {
    await open(page, "?debug=1");
    await control(page, "Pause").click();
    await expectState(page, "paused", 0);
  });

  test("a row highlight lands at its cue", async ({ page }) => {
    await seek(page, M1_CUE_TIMES.row - AFTER_CUE_MS);
    await expect(cell(page, "a", 0, 0)).toHaveAttribute(
      "data-highlight",
      "none",
    );
    await seek(page, M1_CUE_TIMES.row + AFTER_CUE_MS);
    for (const c of [0, 1])
      await expect(cell(page, "a", 0, c)).toHaveAttribute(
        "data-highlight",
        "accent",
      );
    await expect(cell(page, "a", 1, 0)).toHaveAttribute(
      "data-highlight",
      "none",
    );
  });

  test("a column highlight lands at its cue", async ({ page }) => {
    await seek(page, M1_CUE_TIMES.col + AFTER_CUE_MS);
    for (const r of [0, 1])
      await expect(cell(page, "b", r, 0)).toHaveAttribute(
        "data-highlight",
        "accent",
      );
  });

  test("seeking backwards gives the earlier board", async ({ page }) => {
    await seek(page, M1_CUE_TIMES.done + 1000);
    await expect(cell(page, "c", 0, 0)).toHaveAttribute("data-value", "19");
    await seek(page, M1_CUE_TIMES.row + AFTER_CUE_MS);
    await expect(cell(page, "c", 0, 0)).toHaveAttribute("data-value", "");
    await expect(cell(page, "b", 0, 0)).toHaveAttribute(
      "data-highlight",
      "none",
    );
  });

  test("?debug=1 shows currentTime and the last fired cue", async ({
    page,
  }) => {
    const debug = page.getByTestId("player-debug");
    await seek(page, M1_CUE_TIMES.slide + AFTER_CUE_MS);
    await expect(debug).toHaveAttribute(
      "data-current-time",
      ((M1_CUE_TIMES.slide + AFTER_CUE_MS) / 1000).toFixed(3),
    );
    await expect(debug).toHaveAttribute("data-last-cue", "slide");
    await expect(debug).toContainText("last cue slide");
    await seek(page, M1_CUE_TIMES.row - AFTER_CUE_MS);
    await expect(debug).toHaveAttribute("data-last-cue", "");
    await expect(debug).toContainText("last cue none");
  });
});

test("no debug overlay without ?debug=1", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("player-debug")).toHaveCount(0);
});
