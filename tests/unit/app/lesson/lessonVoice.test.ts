// When the lesson keeps its voice session open (app/lesson/[lessonId]/useLessonVoice.ts,
// issue #93): from the first play until the lesson ends, and not while the tab is away.
import { describe, expect, it } from "vitest";
import { wantsVoice } from "@/app/lesson/[lessonId]/useLessonVoice";
import type { PlayerState } from "@/player/machine";

const base = { started: true, away: false, stepCount: 3 };
const at = (state: PlayerState, over: Partial<typeof base> = {}) =>
  wantsVoice({ ...base, ...over, state });

describe("wantsVoice", () => {
  it("not before the lesson first plays (no gesture yet for audio and the mic)", () => {
    expect(at({ kind: "paused", step: 0 }, { started: false })).toBe(false);
  });

  it("while explaining, held on, loading, at the end of a mid-lesson step, or asking", () => {
    expect(at({ kind: "playing", step: 0 })).toBe(true);
    expect(at({ kind: "paused", step: 1 })).toBe(true);
    expect(at({ kind: "loading", step: 1, autoplay: true })).toBe(true);
    expect(at({ kind: "stepEnded", step: 1 })).toBe(true);
    expect(at({ kind: "asking", from: { kind: "playing", step: 2 } })).toBe(
      true,
    );
  });

  it("not once the lesson has ended (the last step ended, or finished), asking included", () => {
    expect(at({ kind: "stepEnded", step: 2 })).toBe(false);
    expect(at({ kind: "finished", step: 2 })).toBe(false);
    expect(at({ kind: "asking", from: { kind: "finished", step: 2 } })).toBe(
      false,
    );
  });

  it("not while the tab has been hidden for a while", () => {
    expect(at({ kind: "playing", step: 0 }, { away: true })).toBe(false);
  });
});
