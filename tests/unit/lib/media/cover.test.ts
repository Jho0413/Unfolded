// The cover (ROADMAP L4, ARCHITECTURE.md section 5.1): the rows the plan route can't reach,
// since it always makes a new lesson. fal is the fake in lib/fakes/fal.ts, never the real one.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeImages } from "@/lib/fakes/fal";
import { addCover, CoverTimeoutError, withDeadline } from "@/lib/media/cover";
import type { LessonPlan } from "@/shared/lesson";

const state = vi.hoisted(() => ({ runs: "" }));
vi.mock("@/lib/config", async (importOriginal) => {
  const { config } = await importOriginal<typeof import("@/lib/config")>();
  return {
    config: {
      ...config,
      get runsDir() {
        return state.runs;
      },
    },
  };
});

const PLAN: LessonPlan = {
  title: "A Paper",
  coverPrompt: "a simple cover",
  steps: [{ title: "One", goal: "Teach one idea." }],
};
const JPEG = { bytes: new Uint8Array([0xff, 0xd8]), contentType: "image/jpeg" };

beforeEach(async () => {
  state.runs = await mkdtemp(path.join(tmpdir(), "l4-cover-"));
});
afterEach(async () => {
  await rm(state.runs, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("addCover", () => {
  it("a saved cover isn't generated again: fal isn't called and the plan is unchanged", async () => {
    const images = fakeImages([]);
    const saved = { ...PLAN, cover: "cover.jpg" };
    await expect(addCover("lesson-1", saved, images)).resolves.toBe(saved);
    expect(images.prompts).toEqual([]);
    expect(await readdir(state.runs)).toEqual([]);
  });

  it("an empty image is no cover", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const images = fakeImages([{ ...JPEG, bytes: new Uint8Array() }]);
    await expect(addCover("lesson-1", PLAN, images)).resolves.toEqual(PLAN);
  });

  it("a failed save is no cover, not a failed plan", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A lesson id the store refuses, so writeRunFile throws.
    const images = fakeImages([JPEG]);
    await expect(addCover("../bad", PLAN, images)).resolves.toEqual(PLAN);
    expect(warn).toHaveBeenCalled();
  });
});

describe("withDeadline", () => {
  it("answers in time: the value, and the signal never aborts", async () => {
    let signal: AbortSignal | undefined;
    await expect(
      withDeadline(async (s) => {
        signal = s;
        return 7;
      }, 1000),
    ).resolves.toBe(7);
    expect(signal!.aborted).toBe(false);
  });

  it("past the deadline: CoverTimeoutError, and the work's signal is aborted", async () => {
    let signal: AbortSignal | undefined;
    const late = withDeadline((s) => {
      signal = s;
      return new Promise<never>(() => {});
    }, 20);
    await expect(late).rejects.toThrow(CoverTimeoutError);
    expect(signal!.aborted).toBe(true);
  });

  it("an error from the work is passed on", async () => {
    await expect(
      withDeadline(() => Promise.reject(new Error("boom")), 1000),
    ).rejects.toThrow("boom");
  });
});
