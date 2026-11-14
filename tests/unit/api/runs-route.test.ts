// GET /api/runs/<lessonId>/<file> (ARCHITECTURE.md sections 5.1 and 7): serves a saved file;
// a missing file -> 404 with a clear message; a bad lessonId or file name -> 400.
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/runs/[lessonId]/[file]/route";
import { RUNS_ROUTE_ERRORS } from "@/app/api/runs/[lessonId]/[file]/errors";
import { writeRunFile } from "@/lib/runs/store";

const dirs = vi.hoisted(() => ({ runs: "" }));
vi.mock("@/lib/config", async (importOriginal) => {
  const { config } = await importOriginal<typeof import("@/lib/config")>();
  return {
    config: {
      ...config,
      get runsDir() {
        return dirs.runs;
      },
    },
  };
});

beforeEach(async () => {
  dirs.runs = await mkdtemp(path.join(tmpdir(), "runs-route-"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dirs.runs, { recursive: true, force: true });
});

/** Calls the route the way Next does, with the segment values as params. */
function get(lessonId: string, file: string) {
  const req = new NextRequest(`http://localhost/api/runs/${lessonId}/${file}`);
  return GET(req, { params: Promise.resolve({ lessonId, file }) });
}

async function expectBadName(lessonId: string, file: string) {
  const res = await get(lessonId, file);
  expect(res.status, `${lessonId}/${file}`).toBe(400);
  expect(await res.json()).toEqual({ error: RUNS_ROUTE_ERRORS.badName });
}

describe("serves a saved file", () => {
  it("step JSON as application/json", async () => {
    await writeRunFile("demo-m1", "step-0.v1.json", '{"title":"x"}');
    const res = await get("demo-m1", "step-0.v1.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.json()).toEqual({ title: "x" });
  });

  it("audio as audio/mpeg, byte for byte", async () => {
    const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x01]);
    await writeRunFile("demo-m1", "step-0.v1.mp3", bytes);
    const res = await get("demo-m1", "step-0.v1.mp3");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("media as its image type", async () => {
    await writeRunFile("demo-m1", "cover.png", new Uint8Array([0x89, 0x50]));
    const res = await get("demo-m1", "cover.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });
});

describe("missing file -> 404 with a clear message", () => {
  it("a file that isn't in the run folder", async () => {
    await writeRunFile("demo-m1", "plan.json", "{}");
    const res = await get("demo-m1", "step-9.v1.json");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'No saved file "step-9.v1.json" in lesson "demo-m1".',
    });
  });

  it("a lesson with no run folder", async () => {
    const res = await get("no-such-lesson", "plan.json");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: RUNS_ROUTE_ERRORS.missing("no-such-lesson", "plan.json"),
    });
  });
});

describe("bad lessonId -> 400", () => {
  it("not matching ^[a-z0-9-]{1,40}$", async () => {
    for (const id of ["", "Demo", "demo_m1", "a".repeat(41), "demo m1", "démo"])
      await expectBadName(id, "plan.json");
  });

  it("traversal: .., ../x, encoded and absolute", async () => {
    for (const id of [
      "..",
      ".",
      "../runs",
      "%2e%2e",
      "..%2fetc",
      "/etc",
      "demo-m1/..",
    ])
      await expectBadName(id, "plan.json");
  });
});

describe("bad file name -> 400", () => {
  it("traversal: ../, .. and .", async () => {
    await writeRunFile("demo-m1", "plan.json", "{}");
    for (const file of [
      "../demo-m1/plan.json",
      "..",
      ".",
      "../../package.json",
    ])
      await expectBadName("demo-m1", file);
  });

  it("encoded traversal, raw or decoded", async () => {
    for (const file of [
      "%2e%2e%2fplan.json",
      "..%2fplan.json",
      "%2e%2e",
      "..%5cplan.json",
      "..\\plan.json",
    ])
      await expectBadName("demo-m1", file);
  });

  it("absolute paths", async () => {
    for (const file of ["/etc/passwd", "%2fetc%2fpasswd", "C:\\x.json"])
      await expectBadName("demo-m1", file);
  });

  it("hidden, null-byte, Unicode, upper-case, over-long and unknown-type names", async () => {
    for (const file of [
      ".env.json",
      "plan.json\0",
      "plán.json",
      "Plan.json",
      `${"a".repeat(101)}.json`,
      "index.html",
      "_tmp.json",
    ])
      await expectBadName("demo-m1", file);
  });

  it("a symlink to a file outside the run folder", async () => {
    const outside = path.join(
      dirs.runs,
      "..",
      `secret-${path.basename(dirs.runs)}.json`,
    );
    await writeFile(outside, '{"secret":true}');
    await mkdir(path.join(dirs.runs, "demo-m1"));
    await symlink(outside, path.join(dirs.runs, "demo-m1", "plan.json"));
    try {
      await expectBadName("demo-m1", "plan.json");
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("a symlinked lesson folder", async () => {
    await writeRunFile("real", "plan.json", "{}");
    await symlink(path.join(dirs.runs, "real"), path.join(dirs.runs, "linked"));
    await expectBadName("linked", "plan.json");
  });

  it("a folder: no directory listing", async () => {
    await mkdir(path.join(dirs.runs, "demo-m1", "media.json"), {
      recursive: true,
    });
    await expectBadName("demo-m1", "media.json");
  });
});
