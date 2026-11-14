// The upload page (ROADMAP L1): a PDF in, the plan shown as a list of step titles, then into
// the lesson. FAKE_APIS=1 serves the recorded upload and plan, so no provider is called. Each
// lesson this writes goes to the e2e runs folder and is removed afterwards.
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { UPLOAD_ERRORS } from "@/app/upload";
import { LessonPlanOutput } from "@/shared/lesson";
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
const TINY_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
);

const created: string[] = [];
test.afterAll(async () => {
  for (const id of created)
    await rm(path.join(RUNS_DIR, id), { recursive: true, force: true });
});

test("a PDF becomes a plan of step titles, and Start opens the lesson", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("A research paper (PDF)").setInputFiles({
    name: "paper.pdf",
    mimeType: "application/pdf",
    buffer: TINY_PDF,
  });
  await page.getByRole("button", { name: "Make the lesson" }).click();

  const plan = page.getByTestId("plan");
  await expect(plan.getByRole("heading", { name: PLAN.title })).toBeVisible();
  await expect(page.getByTestId("plan-steps").getByRole("listitem")).toHaveText(
    PLAN.steps.map((s) => s.title),
  );

  const start = page.getByTestId("start-lesson");
  const href = await start.getAttribute("href");
  expect(href).toMatch(/^\/lesson\/[a-z0-9-]{1,40}$/);
  created.push(href!.split("/").at(-1)!);
  await start.click();
  await expect(page).toHaveURL(href!);
  await expect(page.getByTestId("lesson")).toBeVisible();
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
