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

// The outline's step status (ARCHITECTURE.md section 5.1): one test per status change.
describe("createPrefetcher statuses", () => {
  it("every step starts not started", () => {
    const steps = createPrefetcher(fakeRoute().fetchStep, 3, log);
    expect(steps.statuses()).toEqual([
      "notStarted",
      "notStarted",
      "notStarted",
    ]);
  });

  it("a prefetch in flight is generating, then ready when the step arrives", async () => {
    const route = fakeRoute();
    const steps = createPrefetcher(route.fetchStep, 3, log);
    steps.prefetch(1);
    expect(steps.statuses()[1]).toBe("generating");
    await route.settle(1, stepAt(1));
    expect(steps.statuses()[1]).toBe("ready");
  });

  it("the player's own request is tracked too", async () => {
    const route = fakeRoute();
    const steps = createPrefetcher(route.fetchStep, 3, log);
    const p = steps.fetchStep(0);
    expect(steps.statuses()[0]).toBe("generating");
    await route.settle(0, stepAt(0));
    await p;
    expect(steps.statuses()[0]).toBe("ready");
  });

  it("an error reply or a rejection is failed", async () => {
    const route = fakeRoute();
    const steps = createPrefetcher(route.fetchStep, 3, log);
    steps.prefetch(1);
    steps.prefetch(2);
    await route.settle(1, { error: STEP_ROUTE_ERRORS.failed });
    await route.settle(2, new Error("offline"));
    expect(steps.statuses()).toEqual(["notStarted", "failed", "failed"]);
  });

  it("a retry after a failure is generating again, and its answer wins", async () => {
    const route = fakeRoute();
    const steps = createPrefetcher(route.fetchStep, 3, log);
    void steps.fetchStep(0).catch(() => {});
    await route.settle(0, new Error("offline"));
    expect(steps.statuses()[0]).toBe("failed");
    const retry = steps.fetchStep(0);
    expect(steps.statuses()[0]).toBe("generating");
    await route.settle(0, stepAt(0));
    await retry;
    expect(steps.statuses()[0]).toBe("ready");
  });

  it("only the latest request for a step sets its status", async () => {
    const route = fakeRoute();
    const steps = createPrefetcher(route.fetchStep, 3, log);
    const first = steps.fetchStep(0);
    const second = steps.fetchStep(0);
    await route.settle(0, stepAt(0)); // the first answers after the second was sent
    await first;
    expect(steps.statuses()[0]).toBe("generating");
    await route.settle(0, { error: STEP_ROUTE_ERRORS.failed });
    await second;
    expect(steps.statuses()[0]).toBe("failed");
  });

  it("subscribers hear each change; the array stays the same object until one", async () => {
    const route = fakeRoute();
    const steps = createPrefetcher(route.fetchStep, 2, log);
    const heard = vi.fn();
    const unsubscribe = steps.subscribe(heard);
    const before = steps.statuses();
    expect(steps.statuses()).toBe(before);
    steps.prefetch(1);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(steps.statuses()).not.toBe(before);
    unsubscribe();
    await route.settle(1, stepAt(1));
    expect(heard).toHaveBeenCalledTimes(1);
    expect(steps.statuses()[1]).toBe("ready");
  });

  it("handing over a prefetched reply makes no new request and keeps it ready", async () => {
    const route = fakeRoute();
    const steps = createPrefetcher(route.fetchStep, 2, log);
    steps.prefetch(1);
    await route.settle(1, stepAt(1));
    await steps.fetchStep(1);
    expect(route.requested()).toEqual([1]);
    expect(steps.statuses()[1]).toBe("ready");
  });
});

describe("createPrefetcher refresh (issue #102, section 5.4)", () => {
  const v2 = (n: number): StepResponse => ({
    ...stepAt(n),
    version: 2,
    audioUrl: `/api/runs/m1/step-${n}.v2.mp3`,
    adaptedFrom: { kind: "question", text: "why?", atStep: n - 1 },
  });

  it("asks again once the first request has answered, and Next gets the new version", async () => {
    const route = fakeRoute();
    const steps = createPrefetcher(route.fetchStep, 3, log);
    steps.prefetch(1);
    steps.refresh(1);
    // Not before the first answers: the server must see a saved step to regenerate.
    expect(route.requested()).toEqual([1]);
    await route.settle(1, stepAt(1));
    expect(route.requested()).toEqual([1, 1]);
    await route.settle(1, v2(1));
    expect(await steps.fetchStep(1)).toEqual(v2(1));
    expect(route.requested()).toEqual([1, 1]);
  });

  it("Next before the new version arrives plays the first copy: it never waits", async () => {
    const route = fakeRoute();
    const steps = createPrefetcher(route.fetchStep, 3, log);
    steps.prefetch(1);
    await route.settle(1, stepAt(1));
    steps.refresh(1);
    await tick();
    expect(await steps.fetchStep(1)).toEqual(stepAt(1));
    // The late reply changes nothing: a later request asks the route again.
    await route.settle(1, v2(1));
    const again = steps.fetchStep(1);
    expect(route.requested()).toEqual([1, 1, 1]);
    await route.settle(1, v2(1));
    expect(await again).toEqual(v2(1));
  });

  it("a refresh answered with an error or a rejection keeps the first copy", async () => {
    for (const failure of [
      { error: "Couldn't make this step." },
      new Error("down"),
    ]) {
      const route = fakeRoute();
      const steps = createPrefetcher(route.fetchStep, 3, log);
      steps.prefetch(1);
      await route.settle(1, stepAt(1));
      steps.refresh(1);
      await tick();
      await route.settle(1, failure);
      expect(await steps.fetchStep(1)).toEqual(stepAt(1));
      expect(steps.statuses()[1]).toBe("ready");
    }
  });

  it("does nothing for a step not prefetched, or already handed over", async () => {
    const route = fakeRoute();
    const steps = createPrefetcher(route.fetchStep, 3, log);
    steps.refresh(2);
    steps.prefetch(1);
    await route.settle(1, stepAt(1));
    await steps.fetchStep(1);
    steps.refresh(1);
    await tick();
    expect(route.requested()).toEqual([1]);
  });

  it("leaves the outline's status alone while it refreshes", async () => {
    const route = fakeRoute();
    const steps = createPrefetcher(route.fetchStep, 3, log);
    steps.prefetch(1);
    await route.settle(1, stepAt(1));
    steps.refresh(1);
    await tick();
    expect(steps.statuses()[1]).toBe("ready");
  });
});
