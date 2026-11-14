// The lesson page's step request (ARCHITECTURE.md sections 5.1 and 6.1): reads a saved step,
// `step-<n>.v<k>.json`, through GET /api/runs/<lessonId>/<file>, and points the player at its
// audio, `step-<n>.v<k>.mp3`, through the same route. Safe in the browser.
//
// Until the step route (POST /api/lessons/<id>/steps/<n>) exists, this is how a saved lesson
// plays; that route will replace it for lessons still being generated.
import type { FetchStep } from "@/player/stepLoader";
import { MESSAGES } from "@/player/machine";
import { SavedStep, STEP_NOT_IN_RUN } from "@/shared/lesson";

type Fetch = (url: string) => Promise<Response>;

/** `versions[n]` is the saved version of step n to play, or null when none is saved. */
export function savedStepFetcher(
  lessonId: string,
  versions: readonly (number | null)[],
  fetchFn: Fetch = (url) => fetch(url),
  log: Pick<Console, "error"> = console,
): FetchStep {
  const base = `/api/runs/${lessonId}`;
  return async (n) => {
    const version = versions[n] ?? null;
    if (version === null) return { error: STEP_NOT_IN_RUN };
    const name = `step-${n}.v${version}`;
    const res = await fetchFn(`${base}/${name}.json`);
    // Removed since the page loaded.
    if (res.status === 404) return { error: STEP_NOT_IN_RUN };
    if (!res.ok) {
      log.error(`[lesson] ${lessonId}/${name}.json: HTTP ${res.status}`);
      return { error: MESSAGES.stepFailed };
    }
    const saved = SavedStep.safeParse(await res.json());
    if (!saved.success) {
      log.error(
        `[lesson] ${lessonId}/${name}.json is not a saved step`,
        saved.error,
      );
      return { error: MESSAGES.stepFailed };
    }
    return { ...saved.data, version, audioUrl: `${base}/${name}.mp3` };
  };
}
