// The lesson outline's rows (ARCHITECTURE.md section 5.6). Pure: from the step on screen, the
// player's state, each step's request status (player/prefetch.ts) and the steps played to their
// end, what each row shows and whether clicking it goes there (goToStep).
import type { PlayerState } from "@/player/machine";
import type { StepFetchStatus } from "@/player/prefetch";

export type OutlineRow = {
  /**
   * done: played to its end (✓). current: on screen. upcoming: not played to its end yet, a
   * step skipped past (Next mid-step, an outline jump) included.
   */
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
  /** Steps that have played to their end this session (Outline.tsx records them). */
  ended: ReadonlySet<number>,
): OutlineRow[] {
  // While asking, a jump is the agent's (go_to_step); the outline waits until Ask closes.
  const asking = state.kind === "asking";
  return statuses.map((fetch, i) => {
    const place =
      i === current ? "current" : ended.has(i) ? "done" : "upcoming";
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
