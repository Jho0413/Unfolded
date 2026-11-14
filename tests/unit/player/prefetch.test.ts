// Prefetch (ROADMAP L2, player/prefetch.ts): a prefetched step is handed to the player's next
// request for it with no new request, once; a failed prefetch is forgotten.
import { describe, expect, it, vi } from "vitest";
import { STEP_ROUTE_ERRORS } from "@/app/api/lessons/[lessonId]/steps/[n]/errors";
import { M1_CUE_TIMES, m1 } from "@/app/dev/board/scenes";
import { createPrefetcher } from "@/player/prefetch";
import type { FetchStep } from "@/player/stepLoader";
import type { StepResponse } from "@/shared/lesson";

type Reply = Awaited<ReturnType<FetchStep>>;

const stepAt = (n: number): StepResponse => ({
  step: m1,
  cueTimes: M1_CUE_TIMES,
  version: 1,
  audioUrl: `/api/runs/m1/step-${n}.v1.mp3`,
});

const log = { info: () => {} };
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A fake route: each request waits for the test to settle it. */
function fakeRoute() {
  const pending: { n: number; settle: (r: Reply | Error) => void }[] = [];
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
  const settle = async (n: number, r: Reply | Error) => {
    const i = pending.findIndex((p) => p.n === n);
    if (i < 0) throw new Error(`no pending request for step ${n}`);
    pending.splice(i, 1)[0].settle(r);
    await tick();
  };
  return {
    fetchStep,
    settle,
    requested: () => fetchStep.mock.calls.map(([n]) => n),
  };
}

describe("createPrefetcher", () => {
  it("without a prefetch, each request goes to the route", async () => {
    const route = fakeRoute();
    const steps = createPrefetcher(route.fetchStep, 3, log);
    const p = steps.fetchStep(0);
    await route.settle(0, stepAt(0));
    expect(await p).toEqual(stepAt(0));
    expect(route.requested()).toEqual([0]);
  });

  it("Next on a prefetched step makes no new request", async () => {
    const route = fakeRoute();
    const steps = createPrefetcher(route.fetchStep, 3, log);
    steps.prefetch(1);
    await route.settle(1, stepAt(1));
    expect(await steps.fetchStep(1)).toEqual(stepAt(1));
    expect(route.requested()).toEqual([1]);
  });

  it("Next while the prefetch is in flight joins it", async () => {
    const route = fakeRoute();
    const steps = createPrefetcher(route.fetchStep, 3, log);
    steps.prefetch(1);
    const p = steps.fetchStep(1);
    await route.settle(1, stepAt(1));
    expect(await p).toEqual(stepAt(1));
    expect(route.requested()).toEqual([1]);
  });

  it("a prefetched reply is handed over once: Retry or Back asks the route again", async () => {
    const route = fakeRoute();
    const steps = createPrefetcher(route.fetchStep, 3, log);
    steps.prefetch(1);
    await route.settle(1, stepAt(1));
    await steps.fetchStep(1);
    const again = steps.fetchStep(1);
    await route.settle(1, stepAt(1));
    expect(await again).toEqual(stepAt(1));
    expect(route.requested()).toEqual([1, 1]);
  });

  it("prefetches nothing past the plan, before step 0, or twice", () => {
    const route = fakeRoute();
    const steps = createPrefetcher(route.fetchStep, 2, log);
    steps.prefetch(2);
    steps.prefetch(-1);
    steps.prefetch(1);
    steps.prefetch(1);
    expect(route.requested()).toEqual([1]);
  });

  it("a prefetch answered with an error is forgotten: reaching the step asks again", async () => {
    const route = fakeRoute();
    const steps = createPrefetcher(route.fetchStep, 2, log);
    steps.prefetch(1);
    await route.settle(1, { error: STEP_ROUTE_ERRORS.failed });
    const next = steps.fetchStep(1);
    await route.settle(1, stepAt(1));
    expect(await next).toEqual(stepAt(1));
    expect(route.requested()).toEqual([1, 1]);
  });

  it("a prefetch that rejects is forgotten, and nothing is left unhandled", async () => {
    const route = fakeRoute();
    const steps = createPrefetcher(route.fetchStep, 2, log);
    steps.prefetch(1);
    await route.settle(1, new TypeError("down"));
    void steps.fetchStep(1);
    expect(route.requested()).toEqual([1, 1]);
  });

  it("Next joining a prefetch that then fails gets the failure", async () => {
    const route = fakeRoute();
    const steps = createPrefetcher(route.fetchStep, 2, log);
    steps.prefetch(1);
    const p = steps.fetchStep(1);
    await route.settle(1, { error: STEP_ROUTE_ERRORS.failed });
    expect(await p).toEqual({ error: STEP_ROUTE_ERRORS.failed });
  });
});
