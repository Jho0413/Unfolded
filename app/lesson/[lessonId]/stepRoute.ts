// The lesson page's step request (ARCHITECTURE.md sections 5.1, 6.1 and 7): POST
// /api/lessons/<lessonId>/steps/<n>, which answers the saved step if there is one and otherwise
// generates it (in replay mode, REPLAY_RUN, it only serves saved steps). Safe in the browser.
//
// An error reply carries its section 7 message ("Couldn't make this step.", "No such lesson or
// step.", "This step isn't in the saved run."), which the player shows in its `failed` state;
// Retry is a new request. A reply without a message, or one that isn't a StepResponse, is
// logged and shown as "Couldn't make this step. Retry?". A network failure rejects, for the
// step loader to report.
import type { FetchStep } from "@/player/stepLoader";
import { MESSAGES } from "@/player/machine";
import { ApiError, StepResponse } from "@/shared/lesson";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export function stepRouteFetcher(
  lessonId: string,
  fetchFn: Fetch = (url, init) => fetch(url, init),
  log: Pick<Console, "error"> = console,
): FetchStep {
  return async (n) => {
    const url = `/api/lessons/${encodeURIComponent(lessonId)}/steps/${n}`;
    const res = await fetchFn(url, { method: "POST" });
    const body: unknown = await res.json().catch(() => undefined);
    if (!res.ok) {
      const error = ApiError.safeParse(body);
      if (error.success) return error.data;
      log.error(`[lesson] POST ${url}: HTTP ${res.status} with no message`);
      return { error: MESSAGES.stepFailed };
    }
    const step = StepResponse.safeParse(body);
    if (!step.success) {
      log.error(`[lesson] POST ${url}: not a step`, step.error);
      return { error: MESSAGES.stepFailed };
    }
    return step.data;
  };
}
