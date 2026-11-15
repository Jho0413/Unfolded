// Whiteboard illustrations (E1, #152, ARCHITECTURE.md section 5.1): the cap's pure decision,
// the run file names, and two steps sharing the last image. The route's rows (fal ok, error,
// timeout, no FAL_KEY, non-JPEG, the cap, replay) are in tests/unit/app/api/step-route.test.ts.
// fal is the fake in lib/fakes/fal.ts, never the real one.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "@/lib/config";
import { fakeImages } from "@/lib/fakes/fal";
import type { ImageMaker } from "@/lib/media/fal";
import { illustrateStep, imagesToMake } from "@/lib/media/stepImages";
import { lessonImageCount, stepImageFileName } from "@/lib/runs/store";
import type { ImageObject, SceneObject, Step } from "@/shared/scene";

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

const LESSON = "lesson-1";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]);
const image = (id: string): ImageObject => ({
  kind: "image",
  id,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  prompt: `a picture of ${id}`,
});
const TEXT: SceneObject = { kind: "text", id: "t", x: 10, y: 10, text: "hi" };
const stepWith = (...objects: SceneObject[]): Step => ({
  title: "A step",
  narration: "Hello.",
  objects,
  actions: [],
});

beforeEach(async () => {
  state.runs = await mkdtemp(path.join(tmpdir(), "e1-images-"));
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  await rm(state.runs, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("imagesToMake: which image objects get an image", () => {
  const a = image("a");
  const b = image("b");
  it.each([
    ["no image objects", [TEXT], 0, 4, 1, []],
    [
      "room left: the first image only (one per step)",
      [TEXT, a, b],
      0,
      4,
      1,
      [a],
    ],
    ["one below the cap: still one", [a], 3, 4, 1, [a]],
    ["at the cap: none", [a], 4, 4, 1, []],
    ["past the cap (a hand-made run): none", [a], 9, 4, 1, []],
    ["two per step, one left under the cap: one", [a, b], 3, 4, 2, [a]],
    ["two per step, room for both: both", [a, b], 0, 4, 2, [a, b]],
  ] as const)("%s", (_, objects, used, cap, perStep, expected) => {
    expect(imagesToMake(objects, used, cap, perStep)).toEqual(expected);
  });

  it("the defaults are config's", () => {
    expect(imagesToMake([a, b], config.maxImagesPerLesson - 1)).toEqual([a]);
    expect(imagesToMake([a], config.maxImagesPerLesson)).toEqual([]);
  });
});

describe("the run files", () => {
  it("stepImageFileName: img-<n>-v<k>-<id>.jpg, an id's underscores as hyphens", () => {
    expect(stepImageFileName(0, 1, "pic")).toBe("img-0-v1-pic.jpg");
    expect(stepImageFileName(3, 12, "lamp_on_desk")).toBe(
      "img-3-v12-lamp-on-desk.jpg",
    );
  });

  it("lessonImageCount: the cover and every board image, nothing else", () => {
    expect(
      lessonImageCount([
        config.cover.file,
        "img-0-v1-a.jpg",
        "img-2-v3-b-c.jpg",
        "step-0.v1.json",
        "step-0.v1.mp3",
        "plan.json",
        "img-0-v1-a.png",
        "cover.png",
      ]),
    ).toBe(3);
    expect(lessonImageCount([])).toBe(0);
  });
});

describe("illustrateStep", () => {
  it("a step with no image objects: unchanged, and fal isn't called", async () => {
    const images = fakeImages([]);
    const step = stepWith(TEXT);
    expect(await illustrateStep(LESSON, 0, step, images)).toBe(step);
    expect(images.prompts).toEqual([]);
  });

  it("names the image after the version this generation saves (one past the newest)", async () => {
    const { writeRunFile } = await import("@/lib/runs/store");
    await writeRunFile(LESSON, "step-0.v1.json", "{}");
    await writeRunFile(LESSON, "step-0.v1.mp3", new Uint8Array([1]));
    const out = await illustrateStep(
      LESSON,
      0,
      stepWith(image("a")),
      fakeImages([JPEG]),
    );
    expect(out.objects).toEqual([
      { ...image("a"), mediaUrl: `/api/runs/${LESSON}/img-0-v2-a.jpg` },
    ]);
  });

  it("two steps generating at once with one image left under the cap: only one calls fal", async () => {
    const { writeRunFile } = await import("@/lib/runs/store");
    await writeRunFile(LESSON, config.cover.file, JPEG);
    for (let i = 2; i < config.maxImagesPerLesson; i++)
      await writeRunFile(LESSON, `img-9-v${i}-x.jpg`, JPEG);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: string[] = [];
    const slow: ImageMaker = {
      async make(prompt) {
        calls.push(prompt);
        await gate;
        return JPEG;
      },
    };
    const first = illustrateStep(LESSON, 0, stepWith(image("a")), slow);
    // Let the first reserve its image before the second counts.
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const second = illustrateStep(LESSON, 1, stepWith(image("b")), slow);
    release();
    const [one, two] = await Promise.all([first, second]);
    expect(calls).toEqual([image("a").prompt]);
    expect(one.objects[0]).toHaveProperty("mediaUrl");
    expect(two.objects[0]).not.toHaveProperty("mediaUrl");
    expect(
      (await readdir(path.join(state.runs, LESSON))).filter((f) =>
        f.startsWith("img-0"),
      ),
    ).toEqual(["img-0-v1-a.jpg"]);
  });
});
