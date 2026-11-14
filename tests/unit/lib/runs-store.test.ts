// lib/runs/store.ts: versioned step files and atomic, contained reads and writes of
// runs/<lessonId>/ (ARCHITECTURE.md sections 5.1 and 5.5).
import { execFileSync } from "node:child_process";
import {
  link,
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
import { LESSON_ID_RE, RUN_FILE_RE } from "@/shared/lesson";
import {
  RunNameError,
  listRunFiles,
  nextStepVersion,
  readRunFile,
  readRunJson,
  saveStepVersion,
  servableContentType,
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

// link() is spied on so a test can make every version look taken.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, link: vi.fn(actual.link) };
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

  it("only versions with a JSON file are saved versions", () => {
    expect(
      stepVersions(["step-0.v1.json", "step-0.v1.mp3", "step-0.v2.mp3"], 0),
    ).toEqual([1]);
  });

  it("a step number that isn't a whole number from 0, or a version below 1, is refused", () => {
    for (const [n, k] of [
      [-1, 1],
      [1.5, 1],
      [0, 0],
      [0, 1.5],
      [Number.NaN, 1],
    ])
      expect(() => stepFileName(n, k)).toThrow(RunNameError);
    expect(() => stepAudioFileName(-1, 1)).toThrow(RunNameError);
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
    const type = (file: string) => servableContentType("demo-m1", file);
    expect(type("step-0.v1.json")).toBe("application/json; charset=utf-8");
    expect(type("step-0.v1.mp3")).toBe("audio/mpeg");
    expect(type("cover.png")).toBe("image/png");
    expect(type("cover.jpg")).toBe("image/jpeg");
    expect(type("cover.jpeg")).toBe("image/jpeg");
    expect(type("cover.webp")).toBe("image/webp");
  });

  it("never serves an unknown extension", () => {
    for (const file of ["page.html", "x.js", "x.svg", "noext", "x.tmp"])
      expect(servableContentType("demo-m1", file)).toBeUndefined();
  });

  it("never serves a bad lessonId", () => {
    expect(servableContentType("Demo", "plan.json")).toBeUndefined();
    expect(servableContentType("..", "plan.json")).toBeUndefined();
  });

  it("property: a servable name always stays directly inside its own run folder", () => {
    const root = path.resolve("/runs");
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.stringMatching(LESSON_ID_RE)),
        fc.oneof(fc.string(), fc.stringMatching(RUN_FILE_RE)),
        (id, file) => {
          if (servableContentType(id, file) === undefined) return;
          const full = path.resolve(root, id, file);
          expect(path.dirname(path.dirname(full))).toBe(root);
          expect(path.basename(path.dirname(full))).toBe(id);
          expect(path.basename(full)).toBe(file);
        },
      ),
    );
  });
});

describe("saving step versions", () => {
  it("the first save of a step is version 1, with its audio and JSON", async () => {
    const k = await saveStepVersion(
      "demo-m1",
      0,
      { title: "x" },
      new Uint8Array([1]),
    );
    expect(k).toBe(1);
    expect((await listRunFiles("demo-m1")).sort()).toEqual([
      "step-0.v1.json",
      "step-0.v1.mp3",
    ]);
    expect(
      await readRunJson(
        "demo-m1",
        "step-0.v1.json",
        z.object({ title: z.string() }),
      ),
    ).toEqual({
      title: "x",
    });
  });

  it("a regeneration is saved as a new version and the older one is kept", async () => {
    await saveStepVersion("demo-m1", 0, { v: 1 }, new Uint8Array([1]));
    expect(
      await saveStepVersion("demo-m1", 0, { v: 2 }, new Uint8Array([2])),
    ).toBe(2);
    expect(
      await readRunJson(
        "demo-m1",
        "step-0.v1.json",
        z.object({ v: z.number() }),
      ),
    ).toEqual({
      v: 1,
    });
  });

  it("two saves at once never share a version", async () => {
    const versions = await Promise.all(
      [1, 2, 3, 4].map((i) =>
        saveStepVersion("demo-m1", 2, { i }, new Uint8Array([i])),
      ),
    );
    expect(versions.sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it("a bad step number is refused before anything is written", async () => {
    for (const n of [-1, 1.5])
      await expect(
        saveStepVersion("demo-m1", n, {}, new Uint8Array([1])),
      ).rejects.toThrow(RunNameError);
    expect(await listRunFiles("demo-m1")).toEqual([]);
  });

  it("a step with no JSON form is refused before its audio claims a version", async () => {
    await expect(
      saveStepVersion("demo-m1", 0, undefined, new Uint8Array([1])),
    ).rejects.toThrow(TypeError);
    expect(await listRunFiles("demo-m1")).toEqual([]);
  });

  it("a save gives up after 100 taken versions instead of spinning", async () => {
    const taken = Object.assign(new Error("taken"), { code: "EEXIST" });
    vi.mocked(link).mockRejectedValue(taken);
    try {
      await expect(
        saveStepVersion("demo-m1", 0, {}, new Uint8Array([1])),
      ).rejects.toThrow("after 100 tries");
      expect(link).toHaveBeenCalledTimes(100);
    } finally {
      vi.mocked(link).mockReset();
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      vi.mocked(link).mockImplementation(actual.link);
    }
  });

  it("a step JSON written outside saveStepVersion is never overwritten", async () => {
    await mkdir(path.join(dirs.runs, "demo-m1"));
    await writeFile(
      path.join(dirs.runs, "demo-m1", "step-0.v1.json"),
      '{"theirs":true}',
    );
    expect(await saveStepVersion("demo-m1", 0, {}, new Uint8Array([1]))).toBe(
      2,
    );
    expect(await readRunJson("demo-m1", "step-0.v1.json", z.unknown())).toEqual(
      { theirs: true },
    );
  });

  it("a hand-made version too large to count past doesn't block saves", () => {
    expect(
      nextStepVersion(["step-0.v9007199254740991.mp3", "step-0.v2.json"], 0),
    ).toBe(3);
  });

  it("a version whose save stopped after its audio is never reused", async () => {
    await writeRunFile("demo-m1", "step-0.v1.mp3", new Uint8Array([9]));
    expect(nextStepVersion(await listRunFiles("demo-m1"), 0)).toBe(2);
    expect(stepVersions(await listRunFiles("demo-m1"), 0)).toEqual([]);
    expect(await saveStepVersion("demo-m1", 0, {}, new Uint8Array([1]))).toBe(
      2,
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

  it("a listing leaves out temporary files of writes in progress", async () => {
    await writeRunJson("demo-m1", "plan.json", {});
    await writeFile(path.join(dirs.runs, "demo-m1", "_in-progress.tmp"), "x");
    expect(await listRunFiles("demo-m1")).toEqual(["plan.json"]);
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

  it("a value with no JSON form is refused and nothing is written", async () => {
    await expect(
      writeRunJson("demo-m1", "plan.json", undefined),
    ).rejects.toThrow(TypeError);
    expect(await listRunFiles("demo-m1")).toEqual([]);
  });

  it("a failed write leaves no temporary file behind", async () => {
    await mkdir(path.join(dirs.runs, "demo-m1", "plan.json"), {
      recursive: true,
    });
    await expect(writeRunJson("demo-m1", "plan.json", {})).rejects.toThrow();
    expect(await readdir(path.join(dirs.runs, "demo-m1"))).toEqual([
      "plan.json",
    ]);
  });

  it("never writes through a symlinked lesson folder", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "runs-outside-"));
    try {
      await symlink(outside, path.join(dirs.runs, "linked"));
      await expect(writeRunFile("linked", "plan.json", "{}")).rejects.toThrow(
        RunNameError,
      );
      await expect(listRunFiles("linked")).rejects.toThrow(RunNameError);
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
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

  it("a FIFO is refused without blocking", async () => {
    await mkdir(path.join(dirs.runs, "demo-m1"));
    execFileSync("mkfifo", [path.join(dirs.runs, "demo-m1", "pipe.json")]);
    expect((await readRunFile("demo-m1", "pipe.json")).kind).toBe("refused");
  });

  it("a run file that isn't JSON throws", async () => {
    await writeRunFile("demo-m1", "plan.json", "{");
    await expect(
      readRunJson("demo-m1", "plan.json", z.unknown()),
    ).rejects.toThrow(SyntaxError);
  });

  it("a run file that fails its schema throws", async () => {
    await writeRunJson("demo-m1", "plan.json", { title: 1 });
    await expect(
      readRunJson("demo-m1", "plan.json", z.object({ title: z.string() })),
    ).rejects.toThrow();
  });
});
