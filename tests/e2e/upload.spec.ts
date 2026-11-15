// The upload page (ROADMAP L1, L4; ARCHITECTURE.md section 5.1): one test per row of its table,
// browser side (app/uploadFlow.ts has the unit tests). A PDF chosen or dropped anywhere goes up
// while a paced stage list runs, the plan is shown with its cover, its ideas in the lesson
// preview and the way in; failures keep the picker. FAKE_APIS=1 serves the recorded upload,
// plan and fal cover, so no provider is called. Each lesson this writes goes to the e2e runs
// folder and is removed afterwards.
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, type Route, test } from "@playwright/test";
import { UPLOAD_ERRORS } from "@/app/upload";
import { HOME_TEXT, UPLOAD_STAGE_MS, UPLOAD_STAGES } from "@/app/uploadFlow";
import { CreateLessonResponse, LessonPlanOutput } from "@/shared/lesson";
import { makePdf } from "../unit/lib/pipeline/pdfs";
import { RUNS_DIR } from "./support/runsDir";
import { savedRun } from "./support/savedRun";

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
const A_PDF = {
  name: "chapter.pdf",
  mimeType: "application/pdf",
  buffer: TINY_PDF,
};
/** A plan answer the browser is given without the route, so no run is written. */
const ANSWER = { lessonId: "routed-plan-0a1b2c3d", plan: PLAN };

const created: string[] = [];
test.afterAll(async () => {
  for (const id of created)
    await rm(path.join(RUNS_DIR, id), { recursive: true, force: true });
});

const picker = (page: Page) => page.getByLabel(HOME_TEXT.pick);

/** Drops a file on the page, as a drag from the desktop would. */
async function drop(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  const dataTransfer = await page.evaluateHandle(
    ({ name, type, bytes }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], name, { type }));
      return dt;
    },
    { name: file.name, type: file.mimeType, bytes: [...file.buffer] },
  );
  // Not on the picker: anywhere on the page.
  await page.dispatchEvent("footer", "drop", { dataTransfer });
}

/** Holds POST /api/lessons until `release()`, then answers with `answer`. */
async function holdUpload(page: Page, answer: (route: Route) => Promise<void>) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/lessons", async (route) => {
    await held;
    await answer(route);
  });
  return release;
}

test("idle | choose a PDF: uploading, then the plan with its cover and ideas, and Start opens the lesson", async ({
  page,
}) => {
  await page.goto("/");
  const release = await holdUpload(page, (route) => route.continue());
  // The lesson id comes from the route's answer, so the run is removed even if a check fails.
  const answer = page.waitForResponse("**/api/lessons");
  await picker(page).setInputFiles(A_PDF);

  await expect(page.getByRole("heading", { name: A_PDF.name })).toBeVisible();
  await expect(
    page.getByTestId("upload-stages").getByRole("listitem"),
  ).toHaveText([...UPLOAD_STAGES]);
  release();
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
  await expect(plan).toContainText(`${PLAN.steps.length} ideas`);
  // The preview shows the plan: its title and ideas in the outline.
  const preview = page.getByRole("region", { name: "Lesson preview" });
  await expect(preview).toContainText(PLAN.title);
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

test("idle | drop a PDF anywhere: uploading, then planned", async ({
  page,
}) => {
  await page.goto("/");
  const release = await holdUpload(page, (route) =>
    route.fulfill({ json: ANSWER }),
  );
  await drop(page, A_PDF);
  await expect(page.getByTestId("upload-stages")).toBeVisible();
  release();
  await expect(
    page.getByTestId("plan").getByRole("heading", { name: PLAN.title }),
  ).toBeVisible();
});

test("idle | drop a non-PDF: stays idle with Please choose a PDF., and nothing is sent", async ({
  page,
}) => {
  const posts: string[] = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/api/lessons")) posts.push(req.method());
  });
  await page.goto("/");
  await drop(page, {
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("just some notes"),
  });
  await expect(page.getByTestId("upload-error")).toHaveText(
    UPLOAD_ERRORS.notPdf,
  );
  await expect(page.getByTestId("upload-form")).toBeVisible();
  await expect(page.getByTestId("upload-stages")).toHaveCount(0);
  expect(posts).toEqual([]);
});

test("uploading: the stages move on by time, and the last keeps going until the answer", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  const release = await holdUpload(page, (route) =>
    route.fulfill({ json: ANSWER }),
  );
  await picker(page).setInputFiles(A_PDF);
  const stages = page.getByTestId("upload-stages").getByRole("listitem");
  await expect(stages.first()).toHaveAttribute("data-status", "on");

  await page.clock.fastForward(UPLOAD_STAGE_MS);
  await expect(stages.nth(0)).toHaveAttribute("data-status", "done");
  await expect(stages.nth(1)).toHaveAttribute("data-status", "on");

  // A minute in, with no answer: never all done.
  await page.clock.fastForward(60_000);
  await expect(stages.last()).toHaveAttribute("data-status", "on");
  await expect(stages.nth(UPLOAD_STAGES.length - 2)).toHaveAttribute(
    "data-status",
    "done",
  );
  await expect(page.getByTestId("plan")).toHaveCount(0);

  release();
  await expect(page.getByTestId("plan")).toBeVisible();
});

test("a file that isn't a PDF by its bytes: the route's Please choose a PDF.", async ({
  page,
}) => {
  await page.goto("/");
  await picker(page).setInputFiles({
    name: "notes.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("just some notes"),
  });
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
  test(`uploading | the route answers ${status}: failed with ${message}, the picker usable`, async ({
    page,
  }) => {
    await page.route("**/api/lessons", (route) =>
      route.fulfill({ status, json: { error: message } }),
    );
    await page.goto("/");
    await picker(page).setInputFiles(A_PDF);
    await expect(page.getByTestId("upload-error")).toHaveText(message);
    await expect(page.getByTestId("plan")).toHaveCount(0);
    await expect(picker(page)).toBeEnabled();
  });
}

for (const [what, answer] of [
  ["a network error", (route: Route) => route.abort()],
  [
    "a body that isn't JSON",
    (route: Route) => route.fulfill({ status: 200, body: "<html>oops" }),
  ],
] as const) {
  test(`uploading | ${what}: failed with the planFailed message`, async ({
    page,
  }) => {
    await page.route("**/api/lessons", answer);
    await page.goto("/");
    await picker(page).setInputFiles(A_PDF);
    await expect(page.getByTestId("upload-error")).toHaveText(
      UPLOAD_ERRORS.planFailed,
    );
  });
}

test("failed | choose again: uploading, then planned", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/lessons", (route) =>
    ++calls === 1
      ? route.fulfill({
          status: 502,
          json: { error: UPLOAD_ERRORS.planFailed },
        })
      : route.fulfill({ json: ANSWER }),
  );
  await page.goto("/");
  await picker(page).setInputFiles(A_PDF);
  await expect(page.getByTestId("upload-error")).toBeVisible();
  // The same file again is a change too: the picker is cleared after each pick.
  await picker(page).setInputFiles(A_PDF);
  await expect(page.getByTestId("plan")).toBeVisible();
  expect(calls).toBe(2);
});

test("planned | Another PDF: idle, with the picker", async ({ page }) => {
  await page.route("**/api/lessons", (route) =>
    route.fulfill({ json: ANSWER }),
  );
  await page.goto("/");
  await picker(page).setInputFiles(A_PDF);
  await page.getByRole("button", { name: HOME_TEXT.another }).click();
  await expect(page.getByTestId("plan")).toHaveCount(0);
  await expect(page.getByTestId("upload-form")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: HOME_TEXT.headline }),
  ).toBeVisible();
});

test("any | sample chip: opens that ready-made lesson", async ({ page }) => {
  // One of lib/config.ts's samples (server-only, so not importable here).
  await using run = await savedRun("m2-attention");
  await page.goto("/");
  const chip = page.getByTestId("sample-lesson").filter({
    hasText: "Matrix multiplication",
  });
  await chip.click();
  await expect(page).toHaveURL(`/lesson/${run.lessonId}`);
  await expect(page.getByTestId("lesson")).toBeVisible();
});
