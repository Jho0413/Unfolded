// lib/runs/store.ts: versioned step files and atomic, contained reads and writes of
// runs/<lessonId>/ (ARCHITECTURE.md sections 5.1 and 5.5).
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import fc from "fast-check";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RUN_FILE_RE } from "@/shared/lesson";
import {
  RunNameError,
  contentTypeFor,
  isServableName,
  listRunFiles,
  nextStepVersion,
  readRunFile,
  readRunJson,
  stepAudioFileName,
  stepFileName,
  stepVersions,
  writeRunFile,
  writeRunJson,
} from "@/lib/runs/store";

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
  dirs.runs = await mkdtemp(path.join(tmpdir(), "runs-store-"));
});
afterEach(async () => {
  await rm(dirs.runs, { recursive: true, force: true });
});

describe("versioned step file names", () => {
  it("step n version k is step-<n>.v<k>.json with audio step-<n>.v<k>.mp3", () => {
    expect(stepFileName(0, 1)).toBe("step-0.v1.json");
    expect(stepAudioFileName(3, 2)).toBe("step-3.v2.mp3");
  });

  it("the first generation of a step is version 1", () => {
    expect(nextStepVersion([], 0)).toBe(1);
    expect(nextStepVersion(["plan.json", "step-1.v1.json"], 0)).toBe(1);
  });

  it("a regeneration is one past the newest version, never overwriting one", () => {
    const files = [
      "step-2.v1.json",
      "step-2.v3.json",
      "step-2.v1.mp3",
      "step-2.v2.json",
    ];
    expect(stepVersions(files, 2)).toEqual([1, 2, 3]);
    expect(nextStepVersion(files, 2)).toBe(4);
  });

  it("ignores files that only look like step files", () => {
    const files = [
      "step-01.v1.json",
      "step-1.v0.json",
      "step-1.v1.json.bak",
      "_x.tmp",
      "step-1.v.json",
    ];
    expect(stepVersions(files, 1)).toEqual([]);
  });

  it("property: every step file name is a valid run file name and reads back as its version", () => {
    fc.assert(
      fc.property(fc.nat(1000), fc.integer({ min: 1, max: 1000 }), (n, k) => {
        expect(RUN_FILE_RE.test(stepFileName(n, k))).toBe(true);
        expect(RUN_FILE_RE.test(stepAudioFileName(n, k))).toBe(true);
        expect(stepVersions([stepFileName(n, k)], n)).toEqual([k]);
        expect(nextStepVersion([stepFileName(n, k)], n)).toBe(k + 1);
      }),
    );
  });
});

describe("servable names", () => {
  it("serves .json, .mp3 and images with their content types", () => {
    expect(contentTypeFor("step-0.v1.json")).toBe(
      "application/json; charset=utf-8",
    );
    expect(contentTypeFor("step-0.v1.mp3")).toBe("audio/mpeg");
    expect(contentTypeFor("cover.png")).toBe("image/png");
    expect(contentTypeFor("cover.jpg")).toBe("image/jpeg");
    expect(contentTypeFor("cover.webp")).toBe("image/webp");
  });

  it("never serves an unknown extension", () => {
    for (const file of ["page.html", "x.js", "x.svg", "noext", "x.tmp"])
      expect(isServableName("demo-m1", file)).toBe(false);
  });

  it("property: a name with a slash, a backslash, a leading dot or any other character is refused", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        for (const file of [`${a}/${b}.json`, `${a}\\${b}.json`, `.${a}.json`])
          expect(isServableName("demo-m1", file)).toBe(false);
      }),
    );
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), (s) => {
        if (!/^[a-z0-9-]+$/.test(s))
          expect(isServableName(s, "plan.json")).toBe(false);
      }),
    );
  });
});

describe("writes", () => {
  it("writes a file into runs/<lessonId>/, creating the folder, and reads it back", async () => {
    await writeRunFile("demo-m1", "step-0.v1.mp3", new Uint8Array([1, 2, 3]));
    const result = await readRunFile("demo-m1", "step-0.v1.mp3");
    expect(result).toEqual({ kind: "ok", data: Buffer.from([1, 2, 3]) });
    expect(await listRunFiles("demo-m1")).toEqual(["step-0.v1.mp3"]);
  });

  it("an atomic write leaves no temporary file behind", async () => {
    await writeRunJson("demo-m1", "plan.json", { title: "a" });
    await writeRunJson("demo-m1", "plan.json", { title: "b" });
    expect(await readdir(path.join(dirs.runs, "demo-m1"))).toEqual([
      "plan.json",
    ]);
    expect(
      await readRunJson(
        "demo-m1",
        "plan.json",
        z.object({ title: z.string() }),
      ),
    ).toEqual({
      title: "b",
    });
  });

  it("refuses to write a bad lessonId or file name", async () => {
    await expect(writeRunFile("../x", "plan.json", "x")).rejects.toThrow(
      RunNameError,
    );
    await expect(writeRunFile("demo-m1", "../plan.json", "x")).rejects.toThrow(
      RunNameError,
    );
    await expect(writeRunFile("demo-m1", "..", "x")).rejects.toThrow(
      RunNameError,
    );
    expect(await readdir(dirs.runs)).toEqual([]);
  });
});

describe("reads", () => {
  it("a missing lesson folder lists no files and reads as missing", async () => {
    expect(await listRunFiles("nope")).toEqual([]);
    expect(await readRunFile("nope", "plan.json")).toEqual({ kind: "missing" });
    expect(await readRunJson("nope", "plan.json", z.unknown())).toBeUndefined();
  });

  it("a symlinked file is refused", async () => {
    const outside = path.join(
      dirs.runs,
      "..",
      `outside-${path.basename(dirs.runs)}.json`,
    );
    await writeFile(outside, "{}");
    await mkdir(path.join(dirs.runs, "demo-m1"));
    await symlink(outside, path.join(dirs.runs, "demo-m1", "plan.json"));
    try {
      expect((await readRunFile("demo-m1", "plan.json")).kind).toBe("refused");
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("a symlinked lesson folder is refused", async () => {
    await writeRunFile("real", "plan.json", "{}");
    await symlink(path.join(dirs.runs, "real"), path.join(dirs.runs, "linked"));
    expect((await readRunFile("linked", "plan.json")).kind).toBe("refused");
  });

  it("a folder is refused, never listed", async () => {
    await mkdir(path.join(dirs.runs, "demo-m1", "media.json"), {
      recursive: true,
    });
    expect((await readRunFile("demo-m1", "media.json")).kind).toBe("refused");
  });

  it("a run file that fails its schema throws", async () => {
    await writeRunJson("demo-m1", "plan.json", { title: 1 });
    await expect(
      readRunJson("demo-m1", "plan.json", z.object({ title: z.string() })),
    ).rejects.toThrow();
  });
});
