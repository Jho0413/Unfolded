// GET /api/runs/<lessonId>/<file> (ARCHITECTURE.md sections 5.1 and 7): serves a saved file;
// a missing file -> 404 with a clear message; a bad lessonId or file name -> 400.
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/runs/[lessonId]/[file]/route";
import { RUNS_ROUTE_ERRORS } from "@/app/api/runs/[lessonId]/[file]/errors";
import { GET as GET_ANSWER } from "@/app/api/runs/[lessonId]/answers/[file]/route";
import { saveAnswer, writeRunFile } from "@/lib/runs/store";
import { ANSWERS_DIR } from "@/shared/lesson";

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
    expect(res.headers.get("cache-control")).toBe("no-store");
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

  it("the paper as application/pdf, byte for byte (the paper viewer, #98)", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
    await writeRunFile("demo-m1", "paper.pdf", bytes);
    const res = await get("demo-m1", "paper.pdf");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });
});

describe("missing file -> 404 with a clear message", () => {
  it("a file that isn't in the run folder (pins the wording)", async () => {
    await writeRunFile("demo-m1", "plan.json", "{}");
    const res = await get("demo-m1", "step-9.v1.json");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'No saved file "step-9.v1.json" in lesson "demo-m1".',
    });
  });

  it("a run with no paper.pdf (made before #98): the viewer stays hidden", async () => {
    await writeRunFile("demo-m1", "plan.json", "{}");
    const res = await get("demo-m1", "paper.pdf");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: RUNS_ROUTE_ERRORS.missing("demo-m1", "paper.pdf"),
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
    expect(console.warn).not.toHaveBeenCalled();
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

  it("an extension it doesn't serve (not logged: any URL can be typed)", async () => {
    for (const file of ["index.html", "x.svg", "x.js", "noext"]) {
      await writeRunFile("demo-m1", file, "<script></script>");
      await expectBadName("demo-m1", file);
    }
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("hidden, null-byte, Unicode, upper-case, over-long and temporary names", async () => {
    for (const file of [
      ".env.json",
      "plan.json\0",
      "plán.json",
      "Plan.json",
      `${"a".repeat(101)}.json`,
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
      expect(console.warn).toHaveBeenCalledWith(
        "[api/runs] demo-m1/plan.json refused: symlink",
      );
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("a symlinked lesson folder", async () => {
    await writeRunFile("real", "plan.json", "{}");
    await symlink(path.join(dirs.runs, "real"), path.join(dirs.runs, "linked"));
    await expectBadName("linked", "plan.json");
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("a folder: no directory listing", async () => {
    await mkdir(path.join(dirs.runs, "demo-m1", "media.json"), {
      recursive: true,
    });
    await expectBadName("demo-m1", "media.json");
    expect(console.warn).toHaveBeenCalledWith(
      "[api/runs] demo-m1/media.json refused: not a regular file",
    );
  });
});

describe("unreadable file -> 500, logged", () => {
  // Root can read a 000 file, so this row needs a normal user (as on CI and the laptops).
  it.skipIf(process.getuid?.() === 0)(
    "a read that fails for another reason",
    async () => {
      await writeRunFile("demo-m1", "plan.json", "{}");
      await chmod(path.join(dirs.runs, "demo-m1", "plan.json"), 0o000);
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await get("demo-m1", "plan.json");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: RUNS_ROUTE_ERRORS.failed });
      expect(error).toHaveBeenCalledWith(
        "[api/runs] demo-m1/plan.json read failed",
        expect.any(Error),
      );
    },
  );
});

// GET /api/runs/<lessonId>/answers/<file> (#105): a drawn answer's audio, with the same checks.
describe("serves a drawn answer's audio from runs/<lessonId>/answers/", () => {
  function getAnswer(lessonId: string, file: string) {
    const req = new NextRequest(
      `http://localhost/api/runs/${lessonId}/${ANSWERS_DIR}/${file}`,
    );
    return GET_ANSWER(req, { params: Promise.resolve({ lessonId, file }) });
  }

  it("a saved answer's audio as audio/mpeg, byte for byte", async () => {
    const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x02]);
    const file = await saveAnswer("demo-m1", { any: "record" }, bytes);
    const res = await getAnswer("demo-m1", file);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("an answer that isn't there: 404 with the folder in the message", async () => {
    await mkdir(path.join(dirs.runs, "demo-m1", ANSWERS_DIR), {
      recursive: true,
    });
    const res = await getAnswer("demo-m1", "nope.mp3");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: RUNS_ROUTE_ERRORS.missing("demo-m1", `${ANSWERS_DIR}/nope.mp3`),
    });
  });

  it("a lesson with no answers yet: 404", async () => {
    await writeRunFile("demo-m1", "plan.json", "{}");
    expect((await getAnswer("demo-m1", "a.mp3")).status).toBe(404);
  });

  it("a bad lessonId or file name: 400", async () => {
    for (const [lessonId, file] of [
      ["../x", "a.mp3"],
      ["demo-m1", ".."],
      ["demo-m1", "a.exe"],
    ]) {
      const res = await getAnswer(lessonId, file);
      expect(res.status, `${lessonId}/${file}`).toBe(400);
    }
  });

  it("an answers folder that is a symlink: 400, nothing read through it", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "outside-"));
    await writeFile(path.join(outside, "a.mp3"), "secret");
    await mkdir(path.join(dirs.runs, "demo-m1"), { recursive: true });
    await symlink(outside, path.join(dirs.runs, "demo-m1", ANSWERS_DIR));
    try {
      const res = await getAnswer("demo-m1", "a.mp3");
      expect(res.status).toBe(400);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
