// GET /api/runs/<lessonId>/<file> through the production server (ARCHITECTURE.md section 5.1):
// checks what the route tests can't, how Next itself routes encoded and dotted paths.
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const LESSON = "e2e-runs-route";
const dir = path.join(process.cwd(), "runs", LESSON);

test.beforeAll(async () => {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "step-0.v1.json"), '{"ok":true}');
});
test.afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("serves a saved step file as JSON", async ({ request }) => {
  const res = await request.get(`/api/runs/${LESSON}/step-0.v1.json`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/json; charset=utf-8");
  expect(await res.json()).toEqual({ ok: true });
});

test("a missing file is a 404 with a clear message", async ({ request }) => {
  const res = await request.get(`/api/runs/${LESSON}/step-9.v1.json`);
  expect(res.status()).toBe(404);
  expect(await res.json()).toEqual({
    error: `No saved file "step-9.v1.json" in lesson "${LESSON}".`,
  });
});

test("encoded traversal never reaches a file outside the run folder", async ({
  request,
}) => {
  for (const p of [
    `${LESSON}/..%2f..%2fpackage.json`,
    `${LESSON}/%2e%2e%2f%2e%2e%2fpackage.json`,
    `%2e%2e/package.json`,
    `${LESSON}/%2fetc%2fpasswd`,
  ]) {
    const res = await request.get(`/api/runs/${p}`, { maxRedirects: 0 });
    expect(res.status(), p).toBeGreaterThanOrEqual(300);
    expect(await res.text(), p).not.toContain('"name": "ai-hackathon"');
  }
});
