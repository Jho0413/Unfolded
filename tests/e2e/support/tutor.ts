// The tutor card's controls (ARCHITECTURE.md section 5.6), for the player and lesson specs.
// There's no transport: each state's buttons are on the card (player/cardView.ts), and the
// keys are Space (hold on / go on), → next, ← back, R say that again, A ask.
import type { Locator, Page } from "@playwright/test";

export const card = (page: Page): Locator => page.getByTestId("tutor-card");

/** A button on the card, by its exact label or a pattern. */
export function cardButton(page: Page, name: string | RegExp): Locator {
  return card(page).getByRole("button", {
    name,
    exact: typeof name === "string",
  });
}

export const holdOn = (page: Page) => cardButton(page, "Hold on");
export const goOn = (page: Page) => cardButton(page, "Go on");
/** "Next: <title> →", at the end of a step or on a failed one. */
export const nextIdea = (page: Page) => cardButton(page, /^Next: /);
export const sayAgain = (page: Page) => cardButton(page, "Say that again");
export const retry = (page: Page) => cardButton(page, "Retry");
/** "Start with “<title>” →", when autoplay was blocked. */
export const start = (page: Page) => cardButton(page, /^Start with /);
/** Closes Ask: "Got it, carry on" after an answer, "Carry on" before. */
export const carryOn = (page: Page) => cardButton(page, /carry on$/i);

/** The always-visible Ask box's input. */
export const askInput = (page: Page) => page.getByLabel("Type your question");
/** The box's mic button, before Ask is open: opens Ask by voice (as A does). */
export const askByVoice = (page: Page) =>
  page.getByRole("button", { name: "Ask by voice" });

/**
 * Opens Ask by voice with the `A` key. On the lesson page, once the lesson's always-on mic is
 * listening (issue #93), the box's mic button is its mute switch, so the lesson specs use `A`.
 */
export async function askByKey(page: Page) {
  await page.keyboard.press("a");
}

/** Types a question in the Ask box and presses Enter (it opens Ask if it's closed). */
export async function askQuestion(page: Page, text: string) {
  await askInput(page).fill(text);
  await askInput(page).press("Enter");
}

/** The latest answer on the card. */
export const answer = (page: Page) => page.getByTestId("ask-answer");
