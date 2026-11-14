// The lesson page on the step route (ROADMAP L2, L3): a freshly uploaded lesson's steps are
// generated through POST /api/lessons/<id>/steps/<n> (the server's fake Claude and TTS), step
// n + 1 is prefetched once step n is on screen, and a step the route can't give shows its
// ARCHITECTURE.md section 7 message in the player's failed state, where Retry asks again.
// Failing replies are browser-side fakes (page.route): the server's own failures are covered
// by the route's unit tests. Replay mode (REPLAY_RUN) is in lesson-replay.spec.ts.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, type Route, test } from "@playwright/test";
import { STEP_ROUTE_ERRORS } from "@/app/api/lessons/[lessonId]/steps/[n]/errors";
import { MESSAGES } from "@/player/machine";
import { NO_SUCH_LESSON, STEP_NOT_IN_RUN } from "@/shared/lesson";
import { RUNS_DIR } from "./support/runsDir";
import { freshLesson } from "./support/savedRun";
import { nextIdea, retry } from "./support/tutor";

test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

async function expectState(page: Page, state: string, step: number) {
  const player = page.getByTestId("player");
  await expect(player).toHaveAttribute("data-state", state);
  await expect(player).toHaveAttribute("data-step", String(step));
}

/**
 * Step `step` arrived and plays. The fake TTS audio (a recording cut short) lasts about 0.2 s,
 * so the step may already have ended by the time this looks.
 */
async function expectPlays(page: Page, step: number) {
  const player = page.getByTestId("player");
  await expect(player).toHaveAttribute("data-state", /^(playing|stepEnded)$/);
  await expect(player).toHaveAttribute("data-step", String(step));
}

/** The step on screen plays to its end (the short fake audio ends by itself). */
async function endStep(page: Page, step: number) {
  await expectState(page, "stepEnded", step);
}

/** Every step route request the page makes, as "POST <n>". */
function stepRequests(page: Page, lessonId: string): string[] {
  const seen: string[] = [];
  const prefix = `/api/lessons/${lessonId}/steps/`;
  page.on("request", (req) => {
    const { pathname } = new URL(req.url());
    if (pathname.startsWith(prefix))
      seen.push(`${req.method()} ${pathname.slice(prefix.length)}`);
  });
  return seen;
}

/** The title of the step the route saved as step-<n>.v1.json. */
async function savedTitle(lessonId: string, n: number): Promise<string> {
  const file = path.join(RUNS_DIR, lessonId, `step-${n}.v1.json`);
  return (
    JSON.parse(await readFile(file, "utf8")) as { step: { title: string } }
  ).step.title;
}

test("a fresh lesson's steps are generated through the step route and play", async ({
  page,
}) => {
  await using run = await freshLesson("e2e-live-fresh");
  const requests = stepRequests(page, run.lessonId);
  await page.goto(`/lesson/${run.lessonId}`);
  await expectPlays(page, 0);
  expect(requests[0]).toBe("POST 0");
  // Generated and saved by the route (fake Claude and TTS), then played.
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(
    await savedTitle(run.lessonId, 0),
  );
  await endStep(page, 0);
  await nextIdea(page).click();
  await expectPlays(page, 1);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(
    await savedTitle(run.lessonId, 1),
  );
  const files = await readdir(path.join(RUNS_DIR, run.lessonId));
  expect(files).toEqual(
    expect.arrayContaining([
      "step-0.v1.mp3",
      "step-1.v1.json",
      "step-1.v1.mp3",
    ]),
  );
});

test("L2: step 1 is prefetched once step 0 is on screen, and Next on it makes no new request", async ({
  page,
}) => {
  await using run = await freshLesson("e2e-live-prefetch", 3);
  const requests = stepRequests(page, run.lessonId);
  const prefetched = page.waitForResponse(
    (res) =>
      res.url().endsWith(`/api/lessons/${run.lessonId}/steps/1`) && res.ok(),
  );
  await page.goto(`/lesson/${run.lessonId}`);
  await expectPlays(page, 0);
  await prefetched;
  expect(requests).toEqual(["POST 0", "POST 1"]);

  await endStep(page, 0);
  await nextIdea(page).click();
  await expectPlays(page, 1);
  // Step 1 came from the prefetch; only step 2's prefetch was added.
  await expect.poll(() => requests).toEqual(["POST 0", "POST 1", "POST 2"]);
  expect(requests.filter((r) => r === "POST 1")).toHaveLength(1);
});

/** Answers the first request for step 0 with `fail`, and lets the next ones through. */
async function failStep0Once(
  page: Page,
  lessonId: string,
  fail: (route: Route) => Promise<void>,
) {
  let failed = false;
  await page.route(`**/api/lessons/${lessonId}/steps/0`, async (route) => {
    if (failed) return route.continue();
    failed = true;
    await fail(route);
  });
}

const STEP_FAILURES: {
  name: string;
  message: string;
  fail: (route: Route) => Promise<void>;
}[] = [
  {
    name: "Step: generation fails (502)",
    message: STEP_ROUTE_ERRORS.failed,
    fail: (route) =>
      route.fulfill({
        status: 502,
        json: { error: STEP_ROUTE_ERRORS.failed },
      }),
  },
  {
    name: "Step: a failure outside the table (500)",
    message: STEP_ROUTE_ERRORS.failed,
    fail: (route) =>
      route.fulfill({
        status: 500,
        json: { error: STEP_ROUTE_ERRORS.failed },
      }),
  },
  {
    name: "Step: replay, the step isn't in the run (404)",
    message: STEP_NOT_IN_RUN,
    fail: (route) =>
      route.fulfill({ status: 404, json: { error: STEP_NOT_IN_RUN } }),
  },
  {
    name: "Route: no such lesson or step (400)",
    message: NO_SUCH_LESSON,
    fail: (route) =>
      route.fulfill({ status: 400, json: { error: NO_SUCH_LESSON } }),
  },
  {
    name: "Step: an error with no message",
    message: MESSAGES.stepFailed,
    fail: (route) => route.fulfill({ status: 504, body: "Gateway Timeout" }),
  },
  {
    name: "Step: the network is down",
    message: MESSAGES.stepFailed,
    fail: (route) => route.abort("internetdisconnected"),
  },
];

for (const { name, message, fail } of STEP_FAILURES) {
  test(`L3 ${name} -> "${message}", and Retry requests the step again and plays it`, async ({
    page,
  }) => {
    const id = `e2e-live-fail-${STEP_FAILURES.findIndex((f) => f.name === name)}`;
    await using run = await freshLesson(id);
    await failStep0Once(page, run.lessonId, fail);
    const requests = stepRequests(page, run.lessonId);
    await page.goto(`/lesson/${run.lessonId}`);
    await expectState(page, "failed", 0);
    await expect(page.getByTestId("player-error")).toHaveText(message);
    // A failed step 0 prefetches nothing.
    expect(requests).toEqual(["POST 0"]);
    await retry(page).click();
    await expectPlays(page, 0);
    expect(requests.slice(0, 2)).toEqual(["POST 0", "POST 0"]);
  });
}

test(`L3 Player: the step's audio fails to load -> "${MESSAGES.audioFailed}", Retry plays it`, async ({
  page,
}) => {
  await using run = await freshLesson("e2e-live-audio");
  let failed = false;
  await page.route(
    `**/api/runs/${run.lessonId}/step-0.*.mp3`,
    async (route) => {
      if (failed) return route.continue();
      failed = true;
      await route.fulfill({
        status: 500,
        json: { error: "Couldn't read this file." },
      });
    },
  );
  const requests = stepRequests(page, run.lessonId);
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "failed", 0);
  await expect(page.getByTestId("player-error")).toHaveText(
    MESSAGES.audioFailed,
  );
  await retry(page).click();
  await expectPlays(page, 0);
  // Retry is a new request; the route serves the step it saved the first time.
  expect(requests.filter((r) => r === "POST 0")).toHaveLength(2);
  expect(await readdir(path.join(RUNS_DIR, run.lessonId))).not.toContain(
    "step-0.v2.json",
  );
});

test("L3: a prefetch that failed is asked again when Next reaches the step", async ({
  page,
}) => {
  await using run = await freshLesson("e2e-live-prefetch-fail");
  let failed = false;
  await page.route(`**/api/lessons/${run.lessonId}/steps/1`, async (route) => {
    if (failed) return route.continue();
    failed = true;
    await route.fulfill({
      status: 502,
      json: { error: STEP_ROUTE_ERRORS.failed },
    });
  });
  const requests = stepRequests(page, run.lessonId);
  await page.goto(`/lesson/${run.lessonId}`);
  await expectPlays(page, 0);
  await expect.poll(() => requests).toEqual(["POST 0", "POST 1"]);
  await endStep(page, 0);
  await nextIdea(page).click();
  await expectPlays(page, 1);
  expect(requests).toEqual(["POST 0", "POST 1", "POST 1"]);
});

test("L3: Next skips a step that keeps failing, and Back returns to it", async ({
  page,
}) => {
  await using run = await freshLesson("e2e-live-skip");
  await page.route(`**/api/lessons/${run.lessonId}/steps/0`, (route) =>
    route.fulfill({ status: 502, json: { error: STEP_ROUTE_ERRORS.failed } }),
  );
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "failed", 0);
  // failed + back on step 0: ignored.
  await page.keyboard.press("ArrowLeft");
  await expectState(page, "failed", 0);
  await nextIdea(page).click();
  await expectPlays(page, 1);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(
    await savedTitle(run.lessonId, 1),
  );
  await page.keyboard.press("ArrowLeft");
  await expectState(page, "failed", 0);
  await expect(page.getByTestId("player-error")).toHaveText(
    STEP_ROUTE_ERRORS.failed,
  );
});

test("L3: Next is off on a failed last step", async ({ page }) => {
  await using run = await freshLesson("e2e-live-skip-last", 1);
  await page.route(`**/api/lessons/${run.lessonId}/steps/0`, (route) =>
    route.fulfill({ status: 502, json: { error: STEP_ROUTE_ERRORS.failed } }),
  );
  await page.goto(`/lesson/${run.lessonId}`);
  await expectState(page, "failed", 0);
  await expect(nextIdea(page)).toHaveCount(0);
  await expect(retry(page)).toBeEnabled();
});
