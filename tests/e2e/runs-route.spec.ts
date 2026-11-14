// GET /api/runs/<lessonId>/<file> through the production server (ARCHITECTURE.md section 5.1):
// checks what the route tests can't, how Next itself routes encoded and dotted paths.
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { RUNS_ROUTE_ERRORS } from "@/app/api/runs/[lessonId]/[file]/errors";

import { RUNS_DIR } from "./support/runsDir";

// fullyParallel runs these tests on several workers, each with its own before/after hooks,
// so each test gets its own lesson folder.
async function savedLesson(id: string) {
  const dir = path.join(RUNS_DIR, `e2e-runs-${id}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "step-0.v1.json"), '{"ok":true}');
  return {
    lessonId: path.basename(dir),
    [Symbol.asyncDispose]: () => rm(dir, { recursive: true, force: true }),
  };
}

test("serves a saved step file as JSON", async ({ request }) => {
  await using lesson = await savedLesson("serves");
  const res = await request.get(`/api/runs/${lesson.lessonId}/step-0.v1.json`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/json; charset=utf-8");
  expect(await res.json()).toEqual({ ok: true });
});

test("a missing file is a 404 with a clear message", async ({ request }) => {
  await using lesson = await savedLesson("missing");
  const res = await request.get(`/api/runs/${lesson.lessonId}/step-9.v1.json`);
  expect(res.status()).toBe(404);
  expect(await res.json()).toEqual({
    error: RUNS_ROUTE_ERRORS.missing(lesson.lessonId, "step-9.v1.json"),
  });
});

test("encoded traversal and absolute paths reach the route and get a 400", async ({
  request,
}) => {
  await using lesson = await savedLesson("traversal");
  for (const file of [
    "..%2f..%2fpackage.json",
    "%2e%2e%2f%2e%2e%2fpackage.json",
    "..%5c..%5cpackage.json",
    "%2fetc%2fpasswd",
  ]) {
    const res = await request.get(`/api/runs/${lesson.lessonId}/${file}`, {
      maxRedirects: 0,
    });
    expect(res.status(), file).toBe(400);
    expect(await res.json(), file).toEqual({
      error: RUNS_ROUTE_ERRORS.badName,
    });
  }
});

test("no directory listing: a run folder URL never lists its files", async ({
  request,
}) => {
  await using lesson = await savedLesson("listing");
  // (A "%2e%2e" segment never gets here: the URL parser collapses it before sending.)
  for (const p of [lesson.lessonId, `${lesson.lessonId}/`]) {
    const res = await request.get(`/api/runs/${p}`, { maxRedirects: 0 });
    expect([308, 404], p).toContain(res.status());
    expect(await res.text(), p).not.toContain("step-0.v1.json");
  }
});
