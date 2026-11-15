// Prefetch (ROADMAP L2, ARCHITECTURE.md section 5.1): once step n is on screen, step n + 1 is
// requested in the background, so pressing Next on it makes no new step request and doesn't
// wait for its generation.
//
// Wraps a FetchStep. `prefetch(n)` requests step n ahead of time (the page calls it with
// n + 1 when the player takes step n). The next request for step n gets that reply, or joins
// it while it's in flight, and it is then handed over, not kept: any later request for n
// (Retry, Back) asks the server again, which serves the saved step. A prefetch that fails is
// forgotten, so reaching the step asks again. No React and no browser APIs.
//
// It also reports each step's request status for the lesson outline (`statuses`, with
// `subscribe` for useSyncExternalStore): not started, generating (a request in flight),
// ready (the latest request answered with the step) or failed. Only the latest request for a
// step sets its status.
//
// `refresh(n)` (issue #102, section 5.4): a learner signal made the prefetched step n out of
// date, so it is asked for again in the background, once the first request has answered (the
// server then regenerates the saved step with the new signals). The first reply is kept: the
// next request for n gets the new reply if it has arrived, and otherwise the first one, so it
// never waits for a regeneration. A refresh that fails is dropped and n's status is left as is.
import type { StepResponse } from "@/shared/lesson";
import type { FetchStep } from "./stepLoader";

type Reply = Awaited<ReturnType<FetchStep>>;

export type StepFetchStatus = "notStarted" | "generating" | "ready" | "failed";

export interface Prefetcher {
  /** The player's step request: a prefetched reply if there is one, otherwise a new request. */
  fetchStep: FetchStep;
  /** Requests step n ahead; nothing past the plan's last step, or already prefetched. */
  prefetch: (n: number) => void;
  /** Asks again for a prefetched step n not yet handed over; nothing otherwise. */
  refresh: (n: number) => void;
  /** Each step's request status; the same array until one changes. */
  statuses: () => readonly StepFetchStatus[];
  /** Called after any status changes; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void;
}

export function createPrefetcher(
  fetchStep: FetchStep,
  stepCount: number,
  log: Pick<Console, "info"> = console,
): Prefetcher {
  const ahead = new Map<number, Promise<Reply>>();
  const latest = new Map<number, Promise<Reply>>();
  /** Refreshes in flight or answered, by step; `step` is set once the new reply arrives. */
  const fresh = new Map<number, { step?: StepResponse }>();
  let statuses: readonly StepFetchStatus[] = Array.from(
    { length: stepCount },
    () => "notStarted" as const,
  );
  const listeners = new Set<() => void>();

  function setStatus(n: number, status: StepFetchStatus) {
    if (statuses[n] === status) return;
    statuses = statuses.map((s, i) => (i === n ? status : s));
    for (const fn of listeners) fn();
  }

  /** A request for step n: it sets n's status, unless a later request replaces it. */
  function request(n: number): Promise<Reply> {
    const reply = fetchStep(n);
    latest.set(n, reply);
    setStatus(n, "generating");
    reply.then(
      (r) => {
        if (latest.get(n) === reply)
          setStatus(n, "error" in r ? "failed" : "ready");
      },
      () => {
        if (latest.get(n) === reply) setStatus(n, "failed");
      },
    );
    return reply;
  }

  function forget(n: number, reply: Promise<Reply>) {
    if (ahead.get(n) === reply) ahead.delete(n);
  }

  return {
    fetchStep: (n) => {
      const refreshed = fresh.get(n)?.step;
      fresh.delete(n);
      const reply = ahead.get(n);
      if (reply === undefined) return request(n);
      ahead.delete(n);
      if (refreshed === undefined) return reply;
      log.info(
        `[player] step ${n}: the refreshed version ${refreshed.version}`,
      );
      return Promise.resolve(refreshed);
    },
    prefetch: (n) => {
      if (n < 0 || n >= stepCount || ahead.has(n)) return;
      log.info(`[player] prefetching step ${n}`);
      const reply = request(n);
      ahead.set(n, reply);
      reply.then(
        (r) => {
          if ("error" in r) forget(n, reply);
        },
        () => forget(n, reply),
      );
    },
    refresh: (n) => {
      const first = ahead.get(n);
      if (first === undefined) return;
      log.info(`[player] refreshing step ${n}`);
      const entry: { step?: StepResponse } = {};
      fresh.set(n, entry);
      void first
        .catch(() => undefined)
        .then(() => (fresh.get(n) === entry ? fetchStep(n) : undefined))
        .then(
          (r) => {
            if (r === undefined || "error" in r || fresh.get(n) !== entry)
              return;
            entry.step = r;
            log.info(`[player] step ${n}: version ${r.version} refreshed`);
          },
          () => {
            if (fresh.get(n) === entry) fresh.delete(n);
          },
        );
    },
    statuses: () => statuses,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
