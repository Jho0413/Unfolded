// lib/media/fal.ts (ARCHITECTURE.md sections 9 and 11, S4): which image maker each mode gets,
// the check on fal's answer, and the real maker's calls, against a mocked @fal-ai/client and
// fetch. Never the real fal.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "@/lib/config";
import { resetEnvForTests } from "@/lib/env";
import { readFixture, readFixtureBytes } from "@/lib/fakes";
import { FalImageResult, falImages } from "@/lib/media/fal";

const runs = vi.hoisted(() => ({ dir: "" }));
vi.mock("@/lib/config", async (importOriginal) => {
  const { config } = await importOriginal<typeof import("@/lib/config")>();
  return {
    config: {
      ...config,
      get runsDir() {
        return runs.dir;
      },
    },
  };
});
const fal = vi.hoisted(() => ({
  credentials: undefined as string | undefined,
  subscribe: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@fal-ai/client", () => ({
  createFalClient: (options: { credentials: string }) => {
    fal.credentials = options.credentials;
    return { subscribe: fal.subscribe, queue: { cancel: fal.cancel } };
  },
}));

const URL_ = "https://v3b.fal.media/files/b/x/cover.jpg";
const RESULT = { images: [{ url: URL_, content_type: "image/jpeg" }] };

function realMode(falKey: string | undefined) {
  vi.stubEnv("FAKE_APIS", undefined);
  vi.stubEnv("REPLAY_RUN", undefined);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
  vi.stubEnv("ELEVENLABS_VOICE_ID", "test-voice");
  vi.stubEnv("FAL_KEY", falKey ?? "");
  resetEnvForTests();
}

beforeEach(() => {
  fal.subscribe.mockReset();
  fal.cancel.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetEnvForTests();
});

describe("falImages() by mode", () => {
  it("real mode with no FAL_KEY: none, so images are hidden", () => {
    realMode(undefined);
    expect(falImages()).toBeUndefined();
  });

  it("replay mode, even with a FAL_KEY: none, so replay never calls fal", async () => {
    runs.dir = await mkdtemp(path.join(tmpdir(), "l4-fal-"));
    await mkdir(path.join(runs.dir, "demo-m1"));
    try {
      vi.stubEnv("REPLAY_RUN", "demo-m1");
      vi.stubEnv("FAL_KEY", "fal-test-key");
      resetEnvForTests();
      expect(falImages()).toBeUndefined();
    } finally {
      await rm(runs.dir, { recursive: true, force: true });
    }
  });

  it("FAKE_APIS=1: the fake, serving S4's recorded image", async () => {
    vi.stubEnv("FAKE_APIS", "1");
    vi.stubEnv("REPLAY_RUN", undefined);
    resetEnvForTests();
    const image = await falImages()!.make(
      "anything",
      new AbortController().signal,
    );
    expect(image).toEqual(await readFixtureBytes(config.fal.fixtureImage));
    expect(fal.subscribe).not.toHaveBeenCalled();
  });
});

describe("FalImageResult: fal's answer, checked where it enters", () => {
  it("accepts S4's recorded flux-2 result", async () => {
    expect(
      FalImageResult.safeParse(await readFixture(config.fal.fixture)).success,
    ).toBe(true);
  });

  it.each([
    ["no images", { images: [] }],
    [
      "an http URL",
      {
        images: [
          { url: "http://x.fal.media/a.jpg", content_type: "image/jpeg" },
        ],
      },
    ],
    [
      "not a URL",
      { images: [{ url: "cover.jpg", content_type: "image/jpeg" }] },
    ],
    ["no images field", {}],
  ])("rejects %s", (_, value) => {
    expect(FalImageResult.safeParse(value).success).toBe(false);
  });
});

describe("the real maker (mocked client)", () => {
  it("asks config.fal.model for a JPEG of config.fal.imageSize with the key, then downloads it", async () => {
    realMode("fal-test-key");
    fal.subscribe.mockResolvedValue({ data: RESULT, requestId: "req-1" });
    const fetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/jpeg" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    const image = await falImages()!.make("a cover", signal);
    expect(fal.credentials).toBe("fal-test-key");
    expect(fal.subscribe).toHaveBeenCalledWith(
      config.fal.model,
      expect.objectContaining({
        input: {
          prompt: "a cover",
          image_size: config.fal.imageSize,
          output_format: "jpeg",
        },
        abortSignal: signal,
      }),
    );
    expect(fetch).toHaveBeenCalledWith(URL_, { signal });
    expect(image).toEqual(new Uint8Array([1, 2, 3]));
    expect(fal.cancel).not.toHaveBeenCalled();
  });

  it("an answer that fails the check is an error, and nothing is downloaded", async () => {
    realMode("fal-test-key");
    fal.subscribe.mockResolvedValue({ data: { images: [] }, requestId: "r" });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      falImages()!.make("a cover", new AbortController().signal),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a failed download is an error", async () => {
    realMode("fal-test-key");
    fal.subscribe.mockResolvedValue({ data: RESULT, requestId: "r" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 404 })),
    );
    await expect(
      falImages()!.make("a cover", new AbortController().signal),
    ).rejects.toThrow("HTTP 404");
  });

  it("aborted once queued: fal is asked to cancel that request", async () => {
    realMode("fal-test-key");
    const controller = new AbortController();
    fal.subscribe.mockImplementation(
      (
        _model: string,
        options: { onEnqueue: (id: string) => void; abortSignal: AbortSignal },
      ) => {
        options.onEnqueue("req-42");
        controller.abort();
        return Promise.reject(options.abortSignal.reason);
      },
    );
    await expect(
      falImages()!.make("a cover", controller.signal),
    ).rejects.toBeDefined();
    expect(fal.cancel).toHaveBeenCalledWith(config.fal.model, {
      requestId: "req-42",
    });
  });
});
