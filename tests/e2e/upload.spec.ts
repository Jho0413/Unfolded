// The upload page (ROADMAP L1, L4): a PDF in, the plan shown with its cover and a list of step
// titles, then into the lesson. FAKE_APIS=1 serves the recorded upload, plan and fal cover, so
// no provider is called. Each
// lesson this writes goes to the e2e runs folder and is removed afterwards.
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { UPLOAD_ERRORS } from "@/app/upload";
import { CreateLessonResponse, LessonPlanOutput } from "@/shared/lesson";
import { makePdf } from "../unit/lib/pipeline/pdfs";
import { RUNS_DIR } from "./support/runsDir";

/** The plan the fake serves (config.plan.fixture). */
const PLAN = LessonPlanOutput.parse(
  JSON.parse(
    JSON.parse(
      readFileSync(
        path.join(process.cwd(), "lib/fakes/fixtures/claude-plan.message.json"),
        "utf8",
      ),
    ).content.at(-1).text,
  ),
);
const TINY_PDF = Buffer.from(makePdf());

const created: string[] = [];
test.afterAll(async () => {
  for (const id of created)
    await rm(path.join(RUNS_DIR, id), { recursive: true, force: true });
});

test("a PDF becomes a plan with its cover and step titles, and Start opens the lesson", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("A research paper (PDF)").setInputFiles({
    name: "paper.pdf",
    mimeType: "application/pdf",
    buffer: TINY_PDF,
  });
  // The lesson id comes from the route's answer, so the run is removed even if a check fails.
  const answer = page.waitForResponse("**/api/lessons");
  await page.getByRole("button", { name: "Make the lesson" }).click();
  const { lessonId } = CreateLessonResponse.parse(await (await answer).json());
  created.push(lessonId);

  const plan = page.getByTestId("plan");
  // The fal fake's cover (L4), served from the run folder, loads.
  const cover = page.getByTestId("plan-cover");
  await expect(cover).toHaveAttribute("src", `/api/runs/${lessonId}/cover.jpg`);
  await expect
    .poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(plan.getByRole("heading", { name: PLAN.title })).toBeVisible();
  await expect(page.getByTestId("plan-steps").getByRole("listitem")).toHaveText(
    PLAN.steps.map((s) => s.title),
  );

  const start = page.getByTestId("start-lesson");
  const href = await start.getAttribute("href");
  expect(href).toBe(`/lesson/${lessonId}`);
  await start.click();
  await expect(page).toHaveURL(href!);
  await expect(page.getByTestId("lesson")).toBeVisible();
  // The lesson page's header shows the same cover (app/lesson, P6).
  await expect(page.getByTestId("lesson-cover")).toHaveAttribute(
    "src",
    `/api/runs/${lessonId}/cover.jpg`,
  );
});

test("a file that isn't a PDF says Please choose a PDF.", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("A research paper (PDF)").setInputFiles({
    name: "notes.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("just some notes"),
  });
  await page.getByRole("button", { name: "Make the lesson" }).click();
  await expect(page.getByTestId("upload-error")).toHaveText(
    UPLOAD_ERRORS.notPdf,
  );
});

test("submitting with no file says Please choose a PDF.", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Make the lesson" }).click();
  await expect(page.getByTestId("upload-error")).toHaveText(
    UPLOAD_ERRORS.notPdf,
  );
});

// The upload messages the route answers with (ARCHITECTURE.md section 7, ROADMAP L3). The
// route's own checks are unit-tested; here, the page shows each message it is sent.
for (const [status, message] of [
  [413, UPLOAD_ERRORS.tooLargeOrLocked],
  [422, UPLOAD_ERRORS.tooLargeOrLocked],
  [502, UPLOAD_ERRORS.planFailed],
] as const) {
  test(`the route answers ${status} -> ${message}`, async ({ page }) => {
    await page.route("**/api/lessons", (route) =>
      route.fulfill({ status, json: { error: message } }),
    );
    await page.goto("/");
    await page.getByLabel("A research paper (PDF)").setInputFiles({
      name: "paper.pdf",
      mimeType: "application/pdf",
      buffer: TINY_PDF,
    });
    await page.getByRole("button", { name: "Make the lesson" }).click();
    await expect(page.getByTestId("upload-error")).toHaveText(message);
    await expect(page.getByTestId("plan")).toHaveCount(0);
  });
}
