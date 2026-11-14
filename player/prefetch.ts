// Prefetch (ROADMAP L2, ARCHITECTURE.md section 5.1): once step n is on screen, step n + 1 is
// requested in the background, so pressing Next on it makes no new step request and doesn't
// wait for its generation.
//
// Wraps a FetchStep. `prefetch(n)` requests step n ahead of time (the page calls it with
// n + 1 when the player takes step n). The next request for step n gets that reply, or joins
// it while it's in flight, and it is then handed over, not kept: any later request for n
// (Retry, Back) asks the server again, which serves the saved step. A prefetch that fails is
// forgotten, so reaching the step asks again. No React and no browser APIs.
import type { FetchStep } from "./stepLoader";

type Reply = Awaited<ReturnType<FetchStep>>;

export interface Prefetcher {
  /** The player's step request: a prefetched reply if there is one, otherwise a new request. */
  fetchStep: FetchStep;
  /** Requests step n ahead; nothing past the plan's last step, or already prefetched. */
  prefetch: (n: number) => void;
}

export function createPrefetcher(
  fetchStep: FetchStep,
  stepCount: number,
  log: Pick<Console, "info"> = console,
): Prefetcher {
  const ahead = new Map<number, Promise<Reply>>();

  function forget(n: number, reply: Promise<Reply>) {
    if (ahead.get(n) === reply) ahead.delete(n);
  }

  return {
    fetchStep: (n) => {
      const reply = ahead.get(n);
      if (reply === undefined) return fetchStep(n);
      ahead.delete(n);
      return reply;
    },
    prefetch: (n) => {
      if (n < 0 || n >= stepCount || ahead.has(n)) return;
      log.info(`[player] prefetching step ${n}`);
      const reply = fetchStep(n);
      ahead.set(n, reply);
      reply.then(
        (r) => {
          if ("error" in r) forget(n, reply);
        },
        () => forget(n, reply),
      );
    },
  };
}
