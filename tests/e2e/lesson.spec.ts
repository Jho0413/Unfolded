// The lesson page (ROADMAP P6): a saved lesson in runs/<lessonId>/ plays in the player, its
// step files and audio coming through GET /api/runs. Saved runs are written by
// ./support/savedRun.ts (no provider is called). The controls themselves are covered on
// /dev/player (player.spec.ts); here, what the page adds: loading a run, the ARCHITECTURE.md
// section 7 messages for a missing lesson or step, and demo-m1.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { MESSAGES } from "@/player/machine";
import { NO_SUCH_LESSON, STEP_NOT_IN_RUN } from "@/shared/lesson";
import { savedRun, savedStepTitle } from "./support/savedRun";

test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

const EVIDENCE = path.join(process.cwd(), "evidence", "42");

async function screenshot(page: Page, name: string) {
  await mkdir(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, `${name}.png`) });
}

async function expectState(page: Page, state: string, step: number) {
  const player = page.getByTestId("player");
  await expect(player).toHaveAttribute("data-state", state);
  await expect(player).toHaveAttribute("data-step", String(step));
}

function control(page: Page, name: string) {
  return page
    .getByRole("toolbar", { name: "Player controls" })
    .getByRole("button", { name, exact: true });
}

/** Plays the step on screen to its end: seek close to the end and let it finish. */
async function endStep(page: Page, step: number) {
  await page.getByTestId("player-audio").evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = Math.max(0, audio.duration - 0.1);
  });
  await expectState(page, "stepEnded", step);
}

test("plays a saved lesson: step 0 autoplays, Next plays step 1", async ({
  page,
}) => {
  await using run = await savedRun("e2e-lesson-plays");
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Matrix multiplication",
  );
  await expectState(page, "playing", 0);
  await expect(page.getByText("Step 1 of 2")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(
    savedStepTitle(0),
  );
  await endStep(page, 0);
  await control(page, "Next").click();
  await expectState(page, "playing", 1);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(
    savedStepTitle(1),
  );
  await endStep(page, 1);
  await control(page, "Next").click();
  await expect(page.getByTestId("player")).toHaveAttribute(
    "data-state",
    "finished",
  );
  await expect(page.getByTestId("player-status")).toHaveText(MESSAGES.finished);
});

test("the step and its audio come through the runs route", async ({ page }) => {
  await using run = await savedRun("e2e-lesson-route");
  const requests: string[] = [];
  page.on("request", (req) => requests.push(new URL(req.url()).pathname));
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  expect(requests).toContain(`/api/runs/${run.lessonId}/step-0.v1.json`);
  expect(requests).toContain(`/api/runs/${run.lessonId}/step-0.v1.mp3`);
});

test("plays the latest saved version of a step", async ({ page }) => {
  await using run = await savedRun("e2e-lesson-versions", { versions: 2 });
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(
    savedStepTitle(0),
  );
});

test("Step: replay, and the step isn't in the run -> failed with the message, Back recovers", async ({
  page,
}) => {
  await using run = await savedRun("e2e-lesson-unsaved", {
    steps: 2,
    unsaved: [1],
  });
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  await endStep(page, 0);
  await control(page, "Next").click();
  await expectState(page, "failed", 1);
  await expect(page.getByTestId("player-error")).toHaveText(STEP_NOT_IN_RUN);
  await screenshot(page, "step-not-in-run");
  await control(page, "Back").click();
  await expectState(page, "playing", 0);
});

test("Route: a lesson with no saved run -> 404 'No such lesson or step.' and a way back", async ({
  page,
}) => {
  const res = await page.goto("/lesson/e2e-lesson-never-saved");
  expect(res?.status()).toBe(404);
  await expect(page.getByTestId("lesson-error")).toHaveText(NO_SUCH_LESSON);
  await screenshot(page, "no-such-lesson");
  await expect(
    page.getByRole("link", { name: "Back to upload" }),
  ).toHaveAttribute("href", "/");
});

test("Route: a bad lessonId -> 404 'No such lesson or step.'", async ({
  page,
}) => {
  for (const id of ["Not-A-Lesson", "a".repeat(41), "..%2fpackage"]) {
    const res = await page.goto(`/lesson/${id}`);
    expect(res?.status(), id).toBe(404);
    await expect(page.getByTestId("lesson-error"), id).toHaveText(
      NO_SUCH_LESSON,
    );
  }
});

test("?debug=1 shows the player's clock overlay", async ({ page }) => {
  await using run = await savedRun("e2e-lesson-debug");
  await page.goto(`/lesson/${run.lessonId}?debug=1`);
  await expectState(page, "playing", 0);
  await expect(page.getByTestId("player-debug")).toBeVisible();
});

test("Real run stand-in: /lesson/demo-m1 plays", async ({ page }) => {
  // The e2e runs folder never holds a real run (./support/runsDir.ts), so this is always the
  // stand-in; the real run (C1's make:m1) is checked by hand.
  await using run = await savedRun("demo-m1");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/lesson/demo-m1");
  await expectState(page, "playing", 0);
  await page.getByTestId("player-audio").evaluate((audio: HTMLAudioElement) => {
    audio.pause();
    audio.currentTime = Math.min(audio.duration, 7.5);
  });
  await expectState(page, "paused", 0);
  await screenshot(page, `${run.lessonId}-fake-run`);
});

test("the plan's cover shows as the page header", async ({ page }) => {
  await using run = await savedRun("e2e-lesson-cover", {
    cover: { name: "cover.png", saved: true },
  });
  await page.goto(`/lesson/${run.lessonId}`);
  const cover = page.getByTestId("lesson-cover");
  await expect(cover).toHaveAttribute(
    "src",
    `/api/runs/${run.lessonId}/cover.png`,
  );
  await expect
    .poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(1);
});

test("Plan or step: a cover that won't load is hidden", async ({ page }) => {
  await using run = await savedRun("e2e-lesson-no-cover", {
    cover: { name: "cover.png", saved: false },
  });
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "playing", 0);
  await expect(page.getByTestId("lesson-cover")).toHaveCount(0);
});
