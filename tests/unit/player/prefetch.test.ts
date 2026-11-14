// Prefetch (ROADMAP L2, player/prefetch.ts): step n + 1 is requested once step n arrives, a
// prefetched step is never requested again, and a failed request is forgotten so Retry asks
// again.
import { describe, expect, it, vi } from "vitest";
import { M1_CUE_TIMES, m1 } from "@/app/dev/board/scenes";
import { prefetchingFetcher } from "@/player/prefetch";
import type { FetchStep } from "@/player/stepLoader";
import type { StepResponse } from "@/shared/lesson";

const stepAt = (n: number): StepResponse => ({
  step: m1,
  cueTimes: M1_CUE_TIMES,
  version: 1,
  audioUrl: `/api/runs/m1/step-${n}.v1.mp3`,
});

const log = { info: () => {} };

/** A fake route: each request waits for the test to settle it. */
function fakeRoute() {
  const pending: {
    n: number;
    settle: (r: Awaited<ReturnType<FetchStep>> | Error) => void;
  }[] = [];
  const fetchStep = vi.fn<FetchStep>(
    (n) =>
      new Promise((resolve, reject) => {
        pending.push({
          n,
          settle: (r) => (r instanceof Error ? reject(r) : resolve(r)),
        });
      }),
  );
  /** Settles the oldest pending request for step n. */
  const settle = async (
    n: number,
    r: Awaited<ReturnType<FetchStep>> | Error,
  ) => {
    const i = pending.findIndex((p) => p.n === n);
    if (i < 0) throw new Error(`no pending request for step ${n}`);
    pending.splice(i, 1)[0].settle(r);
    await new Promise((r) => setTimeout(r, 0));
  };
  return {
    fetchStep,
    settle,
    requested: () => fetchStep.mock.calls.map(([n]) => n),
  };
}

describe("prefetchingFetcher", () => {
  it("requests step n + 1 once step n arrives, and Next on it makes no new request", async () => {
    const route = fakeRoute();
    const fetchStep = prefetchingFetcher(route.fetchStep, 3, log);
    const first = fetchStep(0);
    expect(route.requested()).toEqual([0]);
    await route.settle(0, stepAt(0));
    expect(await first).toEqual(stepAt(0));
    expect(route.requested()).toEqual([0, 1]);

    // Next before the prefetch finished: it joins it.
    const second = fetchStep(1);
    await route.settle(1, stepAt(1));
    expect(await second).toEqual(stepAt(1));
    expect(route.requested()).toEqual([0, 1, 2]);

    // Next once the prefetch finished: served at once.
    await route.settle(2, stepAt(2));
    expect(await fetchStep(2)).toEqual(stepAt(2));
    expect(route.requested()).toEqual([0, 1, 2]);
  });

  it("never prefetches past the plan's last step", async () => {
    const route = fakeRoute();
    const fetchStep = prefetchingFetcher(route.fetchStep, 1, log);
    const p = fetchStep(0);
    await route.settle(0, stepAt(0));
    await p;
    expect(route.requested()).toEqual([0]);
  });

  it("a step that arrived is kept: going back makes no request", async () => {
    const route = fakeRoute();
    const fetchStep = prefetchingFetcher(route.fetchStep, 2, log);
    const p = fetchStep(0);
    await route.settle(0, stepAt(0));
    await p;
    await route.settle(1, stepAt(1));
    expect(await fetchStep(1)).toEqual(stepAt(1));
    expect(await fetchStep(0)).toEqual(stepAt(0));
    expect(route.requested()).toEqual([0, 1]);
  });

  it("an error reply is forgotten: Retry requests the step again, and nothing is prefetched", async () => {
    const route = fakeRoute();
    const fetchStep = prefetchingFetcher(route.fetchStep, 2, log);
    const failed = fetchStep(0);
    await route.settle(0, { error: "Couldn't make this step." });
    expect(await failed).toEqual({ error: "Couldn't make this step." });
    expect(route.requested()).toEqual([0]);
    const retry = fetchStep(0);
    await route.settle(0, stepAt(0));
    expect(await retry).toEqual(stepAt(0));
    expect(route.requested()).toEqual([0, 0, 1]);
  });

  it("a failed prefetch is forgotten: reaching the step requests it again", async () => {
    const route = fakeRoute();
    const fetchStep = prefetchingFetcher(route.fetchStep, 2, log);
    const p = fetchStep(0);
    await route.settle(0, stepAt(0));
    await p;
    await route.settle(1, new TypeError("down"));
    const next = fetchStep(1);
    expect(route.requested()).toEqual([0, 1, 1]);
    await route.settle(1, stepAt(1));
    expect(await next).toEqual(stepAt(1));
  });

  it("a rejection reaches the caller and is forgotten", async () => {
    const route = fakeRoute();
    const fetchStep = prefetchingFetcher(route.fetchStep, 2, log);
    const p = expect(fetchStep(0)).rejects.toThrow("down");
    await route.settle(0, new TypeError("down"));
    await p;
    void fetchStep(0);
    expect(route.requested()).toEqual([0, 0]);
  });
});
