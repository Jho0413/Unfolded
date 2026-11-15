// The upload page in replay mode (ROADMAP C3, ARCHITECTURE.md section 5.5): REPLAY_RUN=<id>
// redirects to /lesson/<id>, decided per request; otherwise it shows the upload form, and the
// sample lessons this server has (section 5.1).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import { HOME_TEXT } from "@/app/uploadFlow";
import { resetEnvForTests } from "@/lib/env";
import type { LessonPlan } from "@/shared/lesson";

const { connection } = vi.hoisted(() => ({
  connection: vi.fn(() => Promise.resolve()),
}));
vi.mock("next/server", () => ({ connection }));

// Replay mode needs the saved run's folder: point config.runsDir at a temp one. Of the two
// samples, only "sample-here" has a run there.
const { runsDir } = vi.hoisted(() => ({ runsDir: { path: "" } }));
vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    config: {
      ...actual.config,
      get runsDir() {
        return runsDir.path;
      },
      samples: ["sample-missing", "sample-here"],
    },
  };
});
runsDir.path = mkdtempSync(path.join(tmpdir(), "upload-page-"));
mkdirSync(path.join(runsDir.path, "saved-run"));
const SAMPLE_PLAN: LessonPlan = {
  title: "A Sample Lesson Title",
  steps: [{ title: "One", goal: "The first idea." }],
  coverPrompt: "A lamp.",
};
mkdirSync(path.join(runsDir.path, "sample-here"));
writeFileSync(
  path.join(runsDir.path, "sample-here", "plan.json"),
  JSON.stringify(SAMPLE_PLAN),
);
afterAll(() => rmSync(runsDir.path, { recursive: true, force: true }));

/** Not replay, whatever the shell has set. */
function fakeMode() {
  vi.stubEnv("REPLAY_RUN", undefined);
  vi.stubEnv("FAKE_APIS", "1");
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
  connection.mockClear();
});

describe("upload page", () => {
  it("replay mode: redirects to the saved lesson", async () => {
    vi.stubEnv("REPLAY_RUN", "saved-run");
    await expect(Home()).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(Home()).rejects.toMatchObject({
      digest: expect.stringContaining("/lesson/saved-run"),
    });
  });

  it("not replay: shows the upload form", async () => {
    fakeMode();
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain(HOME_TEXT.headline);
    expect(html).toContain('data-testid="upload-form"');
  });

  it("a sample whose run is here: a chip to its lesson, labelled with the plan's title", async () => {
    fakeMode();
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain('href="/lesson/sample-here"');
    expect(html).toContain(SAMPLE_PLAN.title);
  });

  it("server | sample run missing: that chip isn't rendered", async () => {
    fakeMode();
    const html = renderToStaticMarkup(await Home());
    expect(html).not.toContain("sample-missing");
    expect(html.match(/data-testid="sample-lesson"/g)).toHaveLength(1);
  });

  it("is decided per request, not at build time (waits for connection())", async () => {
    fakeMode();
    await Home();
    expect(connection).toHaveBeenCalledTimes(1);
  });
});
