// The pure helpers behind usePlayer and the controls (player/controls.ts,
// ROADMAP P5). The hook itself is driven in a browser by
// tests/e2e/player.spec.ts and player-autoplay.spec.ts.
import { describe, expect, it } from "vitest";
import {
  canSend,
  isPlayPauseKey,
  lastFiredCue,
  playPauseEvent,
  playRejectionEvent,
  statusFor,
  stepOnScreen,
} from "@/player/controls";
import { MESSAGES, type PlayerState } from "@/player/machine";
import type { CuedAction } from "@/shared/scene";

const ctx = { stepCount: 2 };

describe("stepOnScreen", () => {
  it("is the state's step", () => {
    expect(stepOnScreen({ kind: "playing", step: 1 })).toBe(1);
    expect(stepOnScreen({ kind: "loading", step: 1, autoplay: true })).toBe(1);
    expect(stepOnScreen({ kind: "failed", step: 0, message: "x" })).toBe(0);
  });
  it("is the step Ask was opened from while asking", () => {
    const asking: PlayerState = {
      kind: "asking",
      from: { kind: "paused", step: 1 },
      goTo: 0,
    };
    expect(stepOnScreen(asking)).toBe(1);
  });
});

describe("canSend (a control is enabled exactly when the machine changes)", () => {
  it("Next is off while playing and on once the step ends", () => {
    expect(canSend({ kind: "playing", step: 0 }, { type: "next" }, ctx)).toBe(
      false,
    );
    expect(canSend({ kind: "stepEnded", step: 0 }, { type: "next" }, ctx)).toBe(
      true,
    );
  });
  it("Back is off on step 0 after a failure", () => {
    const failed: PlayerState = { kind: "failed", step: 0, message: "x" };
    expect(canSend(failed, { type: "back" }, ctx)).toBe(false);
    expect(canSend(failed, { type: "retry" }, ctx)).toBe(true);
  });
  it("every control is off while loading", () => {
    const loading: PlayerState = { kind: "loading", step: 0, autoplay: true };
    for (const type of ["back", "replay", "resume", "pause", "next"] as const)
      expect(canSend(loading, { type }, ctx)).toBe(false);
  });
});

describe("playPauseEvent (the Play/Pause button and Space)", () => {
  it("pauses while playing", () => {
    expect(playPauseEvent({ kind: "playing", step: 0 })).toEqual({
      type: "pause",
    });
  });
  it("resumes otherwise", () => {
    expect(playPauseEvent({ kind: "paused", step: 0 })).toEqual({
      type: "resume",
    });
    expect(playPauseEvent({ kind: "stepEnded", step: 0 })).toEqual({
      type: "resume",
    });
  });
});

describe("playRejectionEvent", () => {
  it("NotAllowedError (autoplay blocked) → playBlocked", () => {
    expect(
      playRejectionEvent(new DOMException("blocked", "NotAllowedError")),
    ).toEqual({ type: "playBlocked" });
  });
  it("AbortError (a pause or a new source interrupted the play) → nothing", () => {
    expect(playRejectionEvent(new DOMException("x", "AbortError"))).toBeNull();
  });
  it("NotSupportedError → nothing (the element's error event reports it)", () => {
    expect(
      playRejectionEvent(new DOMException("x", "NotSupportedError")),
    ).toBeNull();
  });
  it("anything else → nothing", () => {
    expect(playRejectionEvent(new Error("NotAllowedError"))).toBeNull();
    expect(playRejectionEvent(undefined)).toBeNull();
  });
});

describe("isPlayPauseKey", () => {
  const on = (tagName: string, isContentEditable = false) => ({
    tagName,
    isContentEditable,
  });
  const cases: [string, Parameters<typeof isPlayPauseKey>[0], boolean][] = [
    [
      "Space on the page",
      { key: " ", repeat: false, modified: false, target: on("BODY") },
      true,
    ],
    [
      "Space with no target",
      { key: " ", repeat: false, modified: false, target: null },
      true,
    ],
    [
      "Space on the board",
      { key: " ", repeat: false, modified: false, target: on("svg") },
      true,
    ],
    [
      "a held Space (repeat)",
      { key: " ", repeat: true, modified: false, target: on("BODY") },
      false,
    ],
    [
      "Shift+Space (or another modifier)",
      { key: " ", repeat: false, modified: true, target: on("BODY") },
      false,
    ],
    [
      "another key",
      { key: "a", repeat: false, modified: false, target: on("BODY") },
      false,
    ],
    [
      "Space in a text input",
      { key: " ", repeat: false, modified: false, target: on("INPUT") },
      false,
    ],
    [
      "Space in a textarea",
      { key: " ", repeat: false, modified: false, target: on("TEXTAREA") },
      false,
    ],
    [
      "Space in a select",
      { key: " ", repeat: false, modified: false, target: on("SELECT") },
      false,
    ],
    [
      "Space on a button (it presses the button)",
      { key: " ", repeat: false, modified: false, target: on("BUTTON") },
      false,
    ],
    [
      "Space on a link",
      { key: " ", repeat: false, modified: false, target: on("A") },
      false,
    ],
    [
      "Space in contenteditable",
      { key: " ", repeat: false, modified: false, target: on("DIV", true) },
      false,
    ],
  ];
  it.each(cases)("%s", (_, key, expected) => {
    expect(isPlayPauseKey(key)).toBe(expected);
  });
});

describe("lastFiredCue", () => {
  const act = (cue: string): CuedAction => ({
    do: "show",
    target: { id: "t" },
    durationMs: 0,
    cue,
  });
  const actions = [act("one"), act("two"), act("three"), act("four")];
  // `three` and `four` are back-to-back markers; `unused` has no action.
  const cueTimes = {
    one: 1000,
    two: 2000,
    three: 3000,
    four: 3000,
    unused: 2500,
  };

  it("before the first cue → none", () => {
    expect(lastFiredCue(actions, cueTimes, 999)).toBeNull();
  });
  it("exactly at a cue → that cue", () => {
    expect(lastFiredCue(actions, cueTimes, 1000)).toBe("one");
  });
  it("between cues → the earlier one", () => {
    expect(lastFiredCue(actions, cueTimes, 2050)).toBe("two");
  });
  it("a marker no action uses never fires", () => {
    expect(lastFiredCue(actions, cueTimes, 2600)).toBe("two");
  });
  it("cues at the same time → the last in action order", () => {
    expect(lastFiredCue(actions, cueTimes, 3000)).toBe("four");
  });
  it("after the end → the last cue", () => {
    expect(lastFiredCue(actions, cueTimes, 60_000)).toBe("four");
  });
  it("a cue with no time is skipped", () => {
    expect(lastFiredCue([act("one"), act("lost")], { one: 1000 }, 5000)).toBe(
      "one",
    );
  });
  it("no actions → none", () => {
    expect(lastFiredCue([], cueTimes, 5000)).toBeNull();
  });
});

describe("statusFor (the line under the board)", () => {
  it("failed → the failure message, as an error", () => {
    expect(
      statusFor({ kind: "failed", step: 0, message: "server words" }, null),
    ).toEqual({ tone: "error", text: "server words" });
  });
  it("a notice (Press play to start) → the notice", () => {
    expect(statusFor({ kind: "paused", step: 0 }, MESSAGES.pressPlay)).toEqual({
      tone: "notice",
      text: MESSAGES.pressPlay,
    });
  });
  it("a failure wins over a notice", () => {
    expect(
      statusFor({ kind: "failed", step: 0, message: "x" }, "notice")?.tone,
    ).toBe("error");
  });
  it("loading → which step is loading (1-based)", () => {
    expect(
      statusFor({ kind: "loading", step: 1, autoplay: true }, null),
    ).toEqual({ tone: "info", text: "Loading step 2…" });
  });
  it("finished → the end of the lesson", () => {
    expect(statusFor({ kind: "finished", step: 1 }, null)).toEqual({
      tone: "info",
      text: MESSAGES.finished,
    });
  });
  it("playing, paused or stepEnded with no notice → nothing", () => {
    for (const kind of ["playing", "paused", "stepEnded"] as const)
      expect(statusFor({ kind, step: 0 }, null)).toBeNull();
  });
});
