// The end-of-lesson recap (issue #130) on the lesson page, over a saved run
// (./support/savedRun.ts) with the fake conversation: a question on step 0, step 2 played as a
// version adapted to it (the step route faked, as team B's regeneration answers), then the
// last step's end shows the recap. At desktop and phone width, in light and dark; screenshots
// go to evidence/130/.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { StepResponse } from "@/shared/lesson";
import { RECAP_TEXT } from "@/app/lesson/[lessonId]/recap";
import { savedRun, savedStepTitle } from "./support/savedRun";
import {
  answer,
  askQuestion,
  card,
  carryOn,
  nextIdea,
  sayAgain,
} from "./support/tutor";

test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

const EVIDENCE = path.join(process.cwd(), "evidence", "130");
const QUESTION = "what does a row mean here?";
const player = (page: Page) => page.getByTestId("player");
const recap = (page: Page) => page.getByTestId("lesson-recap");

async function expectState(page: Page, state: string, step: number) {
  await expect(player(page)).toHaveAttribute("data-state", state);
  await expect(player(page)).toHaveAttribute("data-step", String(step));
}

/** Plays the step on screen to its end: seek close to the end and let it finish. */
async function endStep(page: Page, step: number) {
  await expectState(page, "playing", step);
  await page.getByTestId("player-audio").evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = Math.max(0, audio.duration - 0.1);
  });
  await expectState(page, "stepEnded", step);
}

/**
 * The signals route answers 200 (nothing saved), and step 2 always comes back as a version
 * adapted to QUESTION, as team B's route answers after that question.
 */
async function fakeServer(page: Page, lessonId: string) {
  await page.route(`**/api/lessons/${lessonId}/signals`, (route) =>
    route.fulfill({ json: { version: 1 } }),
  );
  await page.route(`**/api/lessons/${lessonId}/steps/2`, async (route) => {
    const saved = (await (await route.fetch()).json()) as StepResponse;
    await route.fulfill({
      json: {
        ...saved,
        version: 2,
        adaptedFrom: { kind: "question", text: QUESTION, atStep: 0 },
      },
    });
  });
}

/** Through a 3-step lesson with a question on step 0, to the last step's end. */
async function playThrough(page: Page, lessonId: string) {
  await fakeServer(page, lessonId);
  await page.goto(`/lesson/${lessonId}`);
  await expectState(page, "playing", 0);
  await askQuestion(page, QUESTION);
  await expect(answer(page)).toContainText("Good question");
  await carryOn(page).click();
  await endStep(page, 0);
  await expect(recap(page)).toHaveCount(0);
  await nextIdea(page).click();
  await endStep(page, 1);
  await expect(recap(page)).toHaveCount(0);
  await nextIdea(page).click();
  await endStep(page, 2);
}

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

for (const [vp, viewport] of Object.entries(VIEWPORTS))
  for (const theme of ["dark", "light"] as const)
    test.describe(`${vp}, ${theme}`, () => {
      test.use({ viewport, colorScheme: theme });

      test("the last step's end: the ideas, the question and the adapted step, each with a replay link that jumps there", async ({
        page,
      }) => {
        await using run = await savedRun(`e2e-recap-${vp}-${theme}`, {
          steps: 3,
        });
        await playThrough(page, run.lessonId);

        await expect(recap(page)).toBeVisible();
        const steps = recap(page).getByTestId("recap-steps");
        await expect(steps).toContainText(RECAP_TEXT.covered(3, 3));
        await expect(steps.getByRole("listitem")).toHaveText([
          new RegExp(savedStepTitle(0).replace(/[()]/g, "\\$&")),
          new RegExp(savedStepTitle(1).replace(/[()]/g, "\\$&")),
          new RegExp(
            `${savedStepTitle(2).replace(/[()]/g, "\\$&")}.*${RECAP_TEXT.adaptedTag}`,
          ),
        ]);
        await expect(recap(page).getByTestId("recap-questions")).toContainText(
          `“${QUESTION}” · idea 1`,
        );
        await expect(recap(page).getByTestId("recap-adapted")).toContainText(
          `Updated because you asked: “${QUESTION}”`,
        );
        // The tutor card still shows under it.
        await expect(card(page)).toBeVisible();

        // It fits: inside the viewport, no sideways scroll, the card not pushed off.
        const box = (await recap(page).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        const cardBox = (await card(page).boundingBox())!;
        expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(viewport.height);
        await mkdir(EVIDENCE, { recursive: true });
        await page.screenshot({
          path: path.join(EVIDENCE, `${vp}-${theme}-recap.png`),
        });

        // The question's replay link jumps to the idea it was asked on.
        await recap(page)
          .getByTestId("recap-questions")
          .getByRole("button", {
            name: RECAP_TEXT.replayLabel(0, savedStepTitle(0)),
          })
          .click();
        await expectState(page, "playing", 0);
        await expect(recap(page)).toHaveCount(0);
      });
    });

test("Close hides the recap; reaching the end again shows it again; the last idea's link replays it", async ({
  page,
}) => {
  await using run = await savedRun("e2e-recap-close", { steps: 3 });
  await playThrough(page, run.lessonId);
  await expect(recap(page)).toBeVisible();
  await page.getByRole("button", { name: RECAP_TEXT.close }).click();
  await expect(recap(page)).toHaveCount(0);
  await expect(card(page)).toBeVisible();

  await sayAgain(page).click();
  await endStep(page, 2);
  await expect(recap(page)).toBeVisible();

  // The idea on screen: replayed from its start, not loaded again.
  await recap(page)
    .getByTestId("recap-steps")
    .getByRole("button", {
      name: RECAP_TEXT.replayLabel(2, savedStepTitle(2)),
    })
    .click();
  await expectState(page, "playing", 2);
  await expect(recap(page)).toHaveCount(0);
});
