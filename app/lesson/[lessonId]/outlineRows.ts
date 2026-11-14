// The lesson outline's rows (ARCHITECTURE.md section 5.6). Pure: from the step on screen, the
// player's state and each step's request status (player/prefetch.ts), what each row shows and
// whether clicking it goes there (goToStep).
import type { PlayerState } from "@/player/machine";
import type { StepFetchStatus } from "@/player/prefetch";

export type OutlineRow = {
  /** done: before the step on screen (✓). current: on screen. upcoming: after it. */
  place: "done" | "current" | "upcoming";
  fetch: StepFetchStatus;
  /** The small line under the title, or none. */
  label: string | null;
  /** Clicking goes to this step: not the one on screen, and not while asking. */
  clickable: boolean;
};

export const OUTLINE_LABELS = {
  done: "Done",
  preparing: "Preparing",
  failed: "Couldn't prepare",
  notReady: "Not ready",
} as const;

export function outlineRows(
  current: number,
  state: PlayerState,
  statuses: readonly StepFetchStatus[],
): OutlineRow[] {
  // While asking, a jump is the agent's (go_to_step); the outline waits until Ask closes.
  const asking = state.kind === "asking";
  return statuses.map((fetch, i) => {
    const place = i < current ? "done" : i === current ? "current" : "upcoming";
    return {
      place,
      fetch,
      // The step on screen is preparing while it loads, even when its reply is already in
      // (its audio is still downloading).
      label:
        place === "current" && state.kind === "loading"
          ? OUTLINE_LABELS.preparing
          : labelOf(place, fetch),
      clickable: !asking && i !== current,
    };
  });
}

function labelOf(
  place: OutlineRow["place"],
  fetch: StepFetchStatus,
): string | null {
  if (fetch === "generating") return OUTLINE_LABELS.preparing;
  if (fetch === "failed") return OUTLINE_LABELS.failed;
  if (place === "done") return OUTLINE_LABELS.done;
  if (place === "upcoming" && fetch === "notStarted")
    return OUTLINE_LABELS.notReady;
  return null;
}
