// Prefetch (ROADMAP L2, ARCHITECTURE.md section 5.1): while step n plays, step n + 1 is already
// being requested, so pressing Next on it makes no new request and doesn't wait for generation.
//
// Wraps a FetchStep. A request for step n shares any request for n already made (prefetched or
// in flight); once step n arrives, step n + 1 is requested in the background if the plan has
// it. A step that arrived is kept, so going back to it costs nothing. A failed request (an
// error reply or a rejection) is forgotten, so Retry, or reaching that step, asks again.
// No React and no browser APIs.
import type { FetchStep } from "./stepLoader";

type Reply = Awaited<ReturnType<FetchStep>>;

export function prefetchingFetcher(
  fetchStep: FetchStep,
  stepCount: number,
  log: Pick<Console, "info"> = console,
): FetchStep {
  const requests = new Map<number, Promise<Reply>>();

  function request(n: number): Promise<Reply> {
    const known = requests.get(n);
    if (known !== undefined) return known;
    const reply = fetchStep(n).then(
      (r) => {
        if ("error" in r) requests.delete(n);
        return r;
      },
      (error: unknown) => {
        requests.delete(n);
        throw error;
      },
    );
    requests.set(n, reply);
    return reply;
  }

  function prefetch(n: number): void {
    if (n >= stepCount || requests.has(n)) return;
    log.info(`[player] prefetching step ${n}`);
    // Its failure is forgotten in `request`; the player asks again when it reaches the step.
    request(n).catch(() => {});
  }

  return async (n) => {
    const reply = await request(n);
    if (!("error" in reply)) prefetch(n + 1);
    return reply;
  };
}
