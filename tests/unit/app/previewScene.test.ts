// app/previewScene.ts: the upload page's sample drawing is a real step, so it's held to the
// same rules as a generated one, and every action is on the clock.
import { describe, expect, it } from "vitest";
import { SAMPLE_CUE_TIMES, SAMPLE_STEP } from "@/app/previewScene";
import { sceneAt, timeline } from "@/player/sceneAt";
import { validateStep } from "@/shared/validate";

describe("the preview's sample step", () => {
  it("passes the step rules", () => {
    const result = validateStep(SAMPLE_STEP, { maxNarrationChars: 1500 });
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it("has a time for every cue its actions use", () => {
    const timed = timeline(SAMPLE_STEP.actions, SAMPLE_CUE_TIMES);
    expect(timed).toHaveLength(SAMPLE_STEP.actions.length);
  });

  it("ends with everything drawn: the T = 2 row, its top cell lit, both curves", () => {
    const timed = timeline(SAMPLE_STEP.actions, SAMPLE_CUE_TIMES);
    const end = Math.max(...timed.map((t) => t.startMs + t.durationMs));
    const state = sceneAt(SAMPLE_STEP.objects, timed, end);
    const byId = new Map(state.objects.map((o) => [o.object.id, o]));
    expect(byId.get("p")?.visible).toBe(true);
    expect(byId.get("t1")?.visible).toBe(false);
    expect(byId.get("t2")?.visible).toBe(true);
    expect(state.active).toEqual([]);
  });
});
