// Which paper passage the narration is on (issue #98, ARCHITECTURE.md section 5.6). Pure: like
// sceneAt, a function of the step and the audio time, so seeks, Back and Replay just work.
import type { CueTimes } from "@/shared/lesson";
import type { CuedPaperRef } from "@/shared/scene";

export type ActivePaperRef = {
  /** The ref's index in the step's `paperRefs`. */
  index: number;
  ref: CuedPaperRef;
  startMs: number;
};

/**
 * The ref that started last by `tMs`: one with a cue starts when its word is spoken
 * (`cueTimes`), one without at 0. A cue with no time is skipped. Refs that start together go
 * to the later one in the list.
 */
export function paperRefAt(
  refs: readonly CuedPaperRef[] | undefined,
  cueTimes: CueTimes,
  tMs: number,
): ActivePaperRef | null {
  let active: ActivePaperRef | null = null;
  (refs ?? []).forEach((ref, index) => {
    const startMs = ref.cue === undefined ? 0 : cueTimes[ref.cue];
    if (startMs === undefined || startMs > tMs) return;
    if (active === null || startMs >= active.startMs)
      active = { index, ref, startMs };
  });
  return active;
}
