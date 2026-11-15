// The lesson page's signal post (issue #102, ARCHITECTURE.md section 5.4): POST
// /api/lessons/<lessonId>/signals with a question, a simplify request or "step n started".
// Fire-and-forget: the learner never sees a failure. It resolves to whether the server recorded
// the signal, and never rejects. A 404 (the route isn't there, e.g. an older server, or no such
// lesson) is logged once per page as info; any other failure is logged as an error.
import { type Signal, SignalResponse } from "@/shared/lesson";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type PostSignal = (signal: Signal) => Promise<boolean>;

export function signalsRoutePoster(
  lessonId: string,
  fetchFn: Fetch = (url, init) => fetch(url, init),
  log: Pick<Console, "error" | "info"> = console,
): PostSignal {
  const url = `/api/lessons/${encodeURIComponent(lessonId)}/signals`;
  let saidMissing = false;
  return async (signal) => {
    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signal),
      });
      if (res.status === 404) {
        if (!saidMissing)
          log.info(`[lesson] POST ${url}: 404, signals aren't recorded`);
        saidMissing = true;
        return false;
      }
      const body: unknown = await res.json().catch(() => undefined);
      if (!res.ok || !SignalResponse.safeParse(body).success) {
        log.error(`[lesson] POST ${url}: HTTP ${res.status}`, body);
        return false;
      }
      return true;
    } catch (error) {
      log.error(`[lesson] POST ${url} failed`, error);
      return false;
    }
  };
}
