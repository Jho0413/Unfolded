// Adapting the lesson after a question (issue #102, ARCHITECTURE.md section 5.4), browser side:
// Ask's questions and simplify requests are posted to the signals route, the prefetched next
// step is asked for again when Ask closes, and a regenerated version says "Updated because you
// asked…". The signals route and the regeneration are team B's: both are faked here with
// page.route, over a saved run (./support/savedRun.ts) and the fake conversation.
import { expect, type Page, type Route, test } from "@playwright/test";
import type { Signal, StepResponse } from "@/shared/lesson";
import { savedRun } from "./support/savedRun";
import { answer, askQuestion, carryOn } from "./support/tutor";

test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

const player = (page: Page) => page.getByTestId("player");
const marker = (page: Page) => page.getByTestId("adapted-marker");

/** On to step 1 from the outline (Next is only on the card once a step ends). */
async function next(page: Page) {
  await page.getByTestId("outline-step").nth(1).click();
}

/** The signals route, faked: records each body and answers the signals version (or 404). */
async function fakeSignals(page: Page, lessonId: string, status = 200) {
  const bodies: Signal[] = [];
  let version = 0;
  await page.route(`**/api/lessons/${lessonId}/signals`, async (route) => {
    const body = route.request().postDataJSON() as Signal;
    bodies.push(body);
    if (status !== 200)
      return route.fulfill({ status, json: { error: "Not found" } });
    if ("question" in body || "simplify" in body) version++;
    await route.fulfill({ json: { version } });
  });
  return bodies;
}

/**
 * Step 1's route: the first request is served from the run (v1), and any later one answers a
 * regenerated v2 adapted to `question`, as team B's route will after a signal.
 */
async function regeneratingStep1(
  page: Page,
  lessonId: string,
  question: string,
) {
  let requests = 0;
  await page.route(
    `**/api/lessons/${lessonId}/steps/1`,
    async (route: Route) => {
      requests++;
      if (requests === 1) return route.continue();
      const saved = (await (await route.fetch()).json()) as StepResponse;
      await route.fulfill({
        json: {
          ...saved,
          version: 2,
          adaptedFrom: { kind: "question", text: question, atStep: 0 },
        },
      });
    },
  );
  return () => requests;
}

const QUESTION = "what does softmax do here?";

test("a question on step 0 -> carry on -> step 1 is asked again and plays as v2 with the marker", async ({
  page,
}) => {
  await using run = await savedRun("e2e-lesson-adapt", { steps: 3 });
  const bodies = await fakeSignals(page, run.lessonId);
  const step1Requests = await regeneratingStep1(page, run.lessonId, QUESTION);
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  // Step 0 v1 started; step 1 prefetched.
  await expect.poll(() => bodies).toContainEqual({ started: 0, version: 1 });
  await expect.poll(step1Requests).toBe(1);
  await expect(marker(page)).toHaveCount(0);

  // The page logs once the refreshed version is kept for step 1.
  const refreshed = page.waitForEvent("console", (m) =>
    m.text().includes("step 1: version 2 refreshed"),
  );
  await askQuestion(page, QUESTION);
  await expect(player(page)).toHaveAttribute("data-state", "asking");
  await expect(answer(page)).toContainText("Good question");
  // Held until Ask closes (it could still turn out to be a command).
  expect(bodies.some((b) => "question" in b)).toBe(false);
  await carryOn(page).click();
  await expect(player(page)).not.toHaveAttribute("data-state", "asking");

  await expect
    .poll(() => bodies.find((b) => "question" in b))
    .toMatchObject({ question: QUESTION, step: 0 });
  const question = bodies.find((b) => "question" in b) as {
    t: number;
  };
  expect(question.t).toBeGreaterThanOrEqual(0);
  // The prefetched step 1 is asked for again, and the new version is kept for Next.
  await refreshed;

  await next(page);
  await expect(player(page)).toHaveAttribute("data-step", "1");
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await expect(marker(page)).toHaveText(
    `Updated because you asked: “${QUESTION}”`,
  );
  await expect.poll(() => bodies).toContainEqual({ started: 1, version: 2 });
  // Going on made no new step request: it played the refreshed reply.
  expect(step1Requests()).toBe(2);
});

test("a spoken lesson command isn't recorded, and nothing is asked again", async ({
  page,
}) => {
  await using run = await savedRun("e2e-lesson-adapt-cmd", { steps: 3 });
  const bodies = await fakeSignals(page, run.lessonId);
  const step1Requests = await regeneratingStep1(page, run.lessonId, "x");
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await expect.poll(step1Requests).toBe(1);

  // The fake agent answers "carry on" with resume_lesson, which closes Ask.
  await askQuestion(page, "ok carry on");
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await page.waitForTimeout(500);
  expect(bodies.filter((b) => !("started" in b))).toEqual([]);
  expect(step1Requests()).toBe(1);
});

test("simplify_upcoming posts a simplify signal at once", async ({ page }) => {
  await using run = await savedRun("e2e-lesson-adapt-simple", { steps: 3 });
  const bodies = await fakeSignals(page, run.lessonId);
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");

  await askQuestion(page, "can you make the next one simpler?");
  await expect(answer(page)).toContainText("simpler");
  await expect
    .poll(() => bodies.find((b) => "simplify" in b))
    .toMatchObject({ step: 0 });
  // Ask is still open: the request is the agent's, not a question to hold.
  await expect(player(page)).toHaveAttribute("data-state", "asking");
});

test("without the signals route (404) the lesson goes on with no error and plays v1", async ({
  page,
}) => {
  await using run = await savedRun("e2e-lesson-adapt-404", { steps: 3 });
  const bodies = await fakeSignals(page, run.lessonId, 404);
  const step1Requests = await regeneratingStep1(page, run.lessonId, "x");
  await page.goto(`/lesson/${run.lessonId}`);
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await expect.poll(step1Requests).toBe(1);

  await askQuestion(page, QUESTION);
  await expect(answer(page)).toContainText("Good question");
  await carryOn(page).click();
  await expect.poll(() => bodies.some((b) => "question" in b)).toBe(true);
  await page.waitForTimeout(300);
  // Nothing was recorded, so nothing is asked again.
  expect(step1Requests()).toBe(1);

  await next(page);
  await expect(player(page)).toHaveAttribute("data-step", "1");
  await expect(player(page)).toHaveAttribute("data-state", "playing");
  await expect(marker(page)).toHaveCount(0);
  await expect(page.getByTestId("player-error")).toHaveCount(0);
});
