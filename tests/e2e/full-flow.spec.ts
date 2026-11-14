// The whole demo with fakes (ROADMAP T1): upload a PDF → plan → Start → step 0 generated
// through the step route and playing → a highlight at its cue → Next (prefetched) → Ask,
// typed → the fake agent calls highlight and draw_scene → the sketch is drawn → close Ask,
// board restored → resume. FAKE_APIS=1 serves the server's fakes (Files API, Claude, TTS,
// fal, sketch) and NEXT_PUBLIC_FAKE_APIS=1 the scripted conversation. Timing is checked by
// seeking to a cue time, never by waiting.
//
// The fake TTS audio is a recording cut to about 0.2 s, while its alignment puts the cues
// 10 to 40 s in, so seeking to a cue would hit the end of the audio. The step's audio is
// served here as silence long enough for every cue.
import { rm } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  CreateLessonResponse,
  SketchResponse,
  StepResponse,
} from "@/shared/lesson";
import { makePdf } from "../unit/lib/pipeline/pdfs";
import { RUNS_DIR } from "./support/runsDir";
import { silentMp3 } from "./support/savedRun";

test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

const AUDIO_MS = 45_000;
const created: string[] = [];
test.afterAll(async () => {
  for (const id of created)
    await rm(path.join(RUNS_DIR, id), { recursive: true, force: true });
});

const player = (page: Page) => page.getByTestId("player");
const board = (page: Page) => page.getByTestId("whiteboard");
const control = (page: Page, name: string) =>
  page
    .getByRole("toolbar", { name: "Player controls" })
    .getByRole("button", { name, exact: true });

async function expectState(page: Page, state: string, step: number) {
  await expect(player(page)).toHaveAttribute("data-state", state);
  await expect(player(page)).toHaveAttribute("data-step", String(step));
}

/** Seeks the step's audio to `ms` and waits for the seek to land. */
async function seek(page: Page, ms: number) {
  await page.getByTestId("player-audio").evaluate(
    (audio: HTMLAudioElement, t) =>
      new Promise<void>((resolve) => {
        audio.addEventListener("seeked", () => resolve(), { once: true });
        audio.currentTime = t;
      }),
    ms / 1000,
  );
}

/** Every data-* attribute on the whiteboard, in document order. */
function boardAttributes(page: Page): Promise<string> {
  return board(page).evaluate((svg) =>
    [svg, ...svg.querySelectorAll("*")]
      .flatMap((el) =>
        [...el.attributes]
          .filter((a) => a.name.startsWith("data-"))
          .map((a) => `${a.name}=${a.value}`),
      )
      .join("\n"),
  );
}

/** The board once two readings agree (renders follow the clock). */
async function settledBoard(page: Page): Promise<string> {
  let last = "";
  await expect
    .poll(async () => {
      const prev = last;
      last = await boardAttributes(page);
      return last === prev;
    })
    .toBe(true);
  return last;
}

async function ask(page: Page, text: string) {
  await page.getByLabel("Type your question").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test("upload → plan → step plays → highlight at its cue → Next → Ask → highlight and draw_scene → close, board restored → resume", async ({
  page,
}) => {
  // Long silent audio for every step (see the top of this file).
  await page.route("**/api/runs/*/step-*.mp3", (route) =>
    route.fulfill({
      contentType: "audio/mpeg",
      body: Buffer.from(silentMp3(AUDIO_MS)),
    }),
  );

  // Upload → plan.
  await page.goto("/");
  await page.getByLabel("A research paper (PDF)").setInputFiles({
    name: "paper.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(makePdf()),
  });
  const lessonAnswer = page.waitForResponse("**/api/lessons");
  await page.getByRole("button", { name: "Make the lesson" }).click();
  const { lessonId, plan } = CreateLessonResponse.parse(
    await (await lessonAnswer).json(),
  );
  created.push(lessonId);
  await expect(page.getByTestId("plan-steps").getByRole("listitem")).toHaveText(
    plan.steps.map((s) => s.title),
  );

  // Start → step 0 generated through the step route, and playing.
  const stepPosts: string[] = [];
  page.on("request", (req) => {
    const { pathname } = new URL(req.url());
    const prefix = `/api/lessons/${lessonId}/steps/`;
    if (req.method() === "POST" && pathname.startsWith(prefix))
      stepPosts.push(pathname.slice(prefix.length));
  });
  const step0Answer = page.waitForResponse(
    (r) => r.url().endsWith(`/api/lessons/${lessonId}/steps/0`) && r.ok(),
  );
  const step1Answer = page.waitForResponse(
    (r) => r.url().endsWith(`/api/lessons/${lessonId}/steps/1`) && r.ok(),
  );
  await page.getByTestId("start-lesson").click();
  await expect(page).toHaveURL(`/lesson/${lessonId}`);
  const step0 = StepResponse.parse(await (await step0Answer).json());
  await expectState(page, "playing", 0);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(
    step0.step.title,
  );

  // A highlight lands at its cue: none just before, on just after.
  const highlight = step0.step.actions.find(
    (a) => a.do === "highlight" && a.target.row !== undefined,
  );
  if (highlight?.do !== "highlight" || highlight.target.row === undefined)
    throw new Error("the fake step has no row highlight");
  const at = step0.cueTimes[highlight.cue];
  const { id, row } = highlight.target;
  const cell = board(page).locator(
    `[data-object-id="${id}"] [data-cell="${row},0"]`,
  );
  await control(page, "Pause").click();
  await expectState(page, "paused", 0);
  await seek(page, at - 50);
  await expect(cell).toHaveAttribute("data-highlight", "none");
  await seek(page, at + 50);
  await expect(cell).toHaveAttribute(
    "data-highlight",
    highlight.color ?? "accent",
  );

  // Next: step 1 was prefetched while step 0 was on screen, so no new request for it.
  await step1Answer;
  await seek(page, AUDIO_MS - 100);
  await control(page, "Play").click();
  await expectState(page, "stepEnded", 0);
  await control(page, "Next").click();
  await expectState(page, "playing", 1);
  expect(stepPosts.filter((n) => n === "1")).toHaveLength(1);

  // Ask from a paused board at t = 0, so "before" is fixed.
  await control(page, "Pause").click();
  await expectState(page, "paused", 1);
  await seek(page, 0);
  const before = await settledBoard(page);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expectState(page, "asking", 1);
  await expect(page.getByTestId("ask-panel")).toHaveAttribute(
    "data-phase",
    "connected",
  );

  // The fake agent highlights the first row of the first object it was told about.
  await expect
    .poll(() => page.evaluate(() => window.__qaFake?.contextUpdates[0] ?? ""))
    .toContain("ids for highlight");
  const ctx = await page.evaluate(() => window.__qaFake?.contextUpdates[0]);
  const first = /ids for highlight\): ([^,\s]+)/.exec(ctx ?? "")?.[1];
  await ask(page, "show me the first row");
  await expect(
    board(page).locator(`[data-object-id="${first}"] [data-cell="0,0"]`),
  ).toHaveAttribute("data-highlight", "accent");

  // draw_scene: the server's fake sketch, drawn on the current board when it arrives.
  const sketchAnswer = page.waitForResponse("**/api/sketch");
  await ask(page, "can you draw it?");
  await expect(
    page.getByTestId("ask-transcript").locator('[data-role="agent"]').last(),
  ).toContainText("Let me sketch that");
  const { sketch } = SketchResponse.parse(await (await sketchAnswer).json());
  for (const o of sketch.objects)
    await expect(board(page).locator(`[data-object-id="${o.id}"]`)).toHaveCount(
      1,
    );
  await expect(page.getByTestId("ask-tool-notice")).toHaveCount(0);

  // Close Ask: back to paused, the drawing gone, the board as before Ask.
  await page.getByRole("button", { name: "Close" }).click();
  await expectState(page, "paused", 1);
  for (const o of sketch.objects)
    await expect(board(page).locator(`[data-object-id="${o.id}"]`)).toHaveCount(
      0,
    );
  await expect.poll(() => boardAttributes(page)).toBe(before);

  // Resume.
  await control(page, "Play").click();
  await expectState(page, "playing", 1);
});
