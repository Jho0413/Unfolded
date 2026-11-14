// player/stepLoader.ts (ROADMAP P5, ARCHITECTURE.md section 6.1 "Where the
// events come from"): each way a step load ends, and that only the latest
// request reports back.
import { describe, expect, it, vi } from "vitest";
import { m1, M1_CUE_TIMES } from "@/app/dev/board/scenes";
import { MESSAGES } from "@/player/machine";
import { createStepLoader, type FetchStep } from "@/player/stepLoader";
import type { StepResponse } from "@/shared/lesson";

const reply = (n: number): StepResponse => ({
  step: { ...m1, title: `step ${n}` },
  version: 1,
  audioUrl: `/api/runs/demo/step-${n}.v1.mp3`,
  cueTimes: M1_CUE_TIMES,
});

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(fetchStep: FetchStep, fetchAudio = async () => new Blob(["x"])) {
  let urls = 0;
  const deps = {
    fetchStep,
    fetchAudio: vi.fn(fetchAudio),
    createUrl: vi.fn(() => `blob:${++urls}`),
    revokeUrl: vi.fn(),
    ready: vi.fn(),
    failed: vi.fn(),
    log: { error: vi.fn(), info: vi.fn() },
  };
  return { deps, loader: createStepLoader(deps) };
}

describe("createStepLoader", () => {
  it("step and audio arrive: ready with the step, its timeline and a blob URL", async () => {
    const { deps, loader } = setup(async (n) => reply(n));
    await loader.load(1);
    expect(deps.fetchAudio).toHaveBeenCalledWith(
      "/api/runs/demo/step-1.v1.mp3",
    );
    expect(deps.ready).toHaveBeenCalledTimes(1);
    const loaded = deps.ready.mock.calls[0][0];
    expect(loaded).toMatchObject({ step: 1, src: "blob:1" });
    expect(loaded.response.step.title).toBe("step 1");
    expect(loaded.timed).toHaveLength(m1.actions.length);
    expect(deps.failed).not.toHaveBeenCalled();
  });

  it("the server answers with an error: failed with the server's message", async () => {
    const { deps, loader } = setup(async () => ({ error: "server words" }));
    await loader.load(0);
    expect(deps.failed).toHaveBeenCalledWith(0, "server words");
    expect(deps.fetchAudio).not.toHaveBeenCalled();
  });

  it("the step request rejects (network down): failed with MESSAGES.stepFailed, logged", async () => {
    const { deps, loader } = setup(async () => {
      throw new TypeError("Failed to fetch");
    });
    await loader.load(0);
    expect(deps.failed).toHaveBeenCalledWith(0, MESSAGES.stepFailed);
    expect(deps.log.error).toHaveBeenCalled();
  });

  it("the audio download fails: failed with MESSAGES.audioFailed, logged", async () => {
    const { deps, loader } = setup(
      async (n) => reply(n),
      async () => {
        throw new Error("HTTP 404");
      },
    );
    await loader.load(0);
    expect(deps.failed).toHaveBeenCalledWith(0, MESSAGES.audioFailed);
    expect(deps.ready).not.toHaveBeenCalled();
    expect(deps.log.error).toHaveBeenCalled();
  });

  it("an older request that finishes later is dropped, logged and its URL freed", async () => {
    const first = deferred<StepResponse>();
    const second = deferred<StepResponse>();
    const pending = [first, second];
    const { deps, loader } = setup(() => pending.shift()!.promise);
    const older = loader.load(0);
    const newer = loader.load(1);
    second.resolve(reply(1));
    await newer;
    first.resolve(reply(0));
    await older;
    expect(deps.ready).toHaveBeenCalledTimes(1);
    expect(deps.ready.mock.calls[0][0].step).toBe(1);
    expect(deps.revokeUrl).toHaveBeenCalledWith("blob:2");
    expect(deps.log.info).toHaveBeenCalledWith(
      "[player] late reply for step 0 dropped",
    );
  });

  it("an older request that fails later is dropped too", async () => {
    const first = deferred<StepResponse>();
    const pending = [first.promise, Promise.resolve(reply(1))];
    const { deps, loader } = setup(() => pending.shift()!);
    const older = loader.load(0);
    await loader.load(1);
    first.reject(new TypeError("Failed to fetch"));
    await older;
    expect(deps.failed).not.toHaveBeenCalled();
    expect(deps.ready).toHaveBeenCalledTimes(1);
  });

  it("cancel (unmount) mid-load: nothing reported, the URL freed", async () => {
    const step = deferred<StepResponse>();
    const { deps, loader } = setup(() => step.promise);
    const load = loader.load(0);
    loader.cancel();
    step.resolve(reply(0));
    await load;
    expect(deps.ready).not.toHaveBeenCalled();
    expect(deps.failed).not.toHaveBeenCalled();
    expect(deps.revokeUrl).toHaveBeenCalledWith("blob:1");
  });
});
