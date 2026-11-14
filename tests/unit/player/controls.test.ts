// The pure helpers behind usePlayer and the controls (player/controls.ts,
// ROADMAP P5). The hook itself is driven in a browser by
// tests/e2e/player.spec.ts and player-autoplay.spec.ts.
import { describe, expect, it } from "vitest";
import {
  canSend,
  carryOnEvent,
  isPlayPauseKey,
  lastFiredCue,
  playPauseEvent,
  playRejectionEvent,
  shortcutEvent,
  stepOnScreen,
} from "@/player/controls";
import type { PlayerState } from "@/player/machine";
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
  it("after a failure, Next skips forward except on the last step", () => {
    const failed = (step: number): PlayerState => ({
      kind: "failed",
      step,
      message: "x",
    });
    expect(canSend(failed(0), { type: "next" }, ctx)).toBe(true);
    expect(canSend(failed(ctx.stepCount - 1), { type: "next" }, ctx)).toBe(
      false,
    );
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

describe("shortcutEvent (→ next, ← back, R again)", () => {
  const on = (tagName: string, isContentEditable = false) => ({
    tagName,
    isContentEditable,
  });
  const key = (k: string, target = on("BODY"), extra = {}) => ({
    key: k,
    repeat: false,
    modified: false,
    target,
    ...extra,
  });
  const cases: [string, Parameters<typeof shortcutEvent>[0], unknown][] = [
    ["→ on the page: next", key("ArrowRight"), { type: "next" }],
    ["← on the page: back", key("ArrowLeft"), { type: "back" }],
    ["r: replay", key("r"), { type: "replay" }],
    ["R (caps): replay", key("R"), { type: "replay" }],
    [
      "no target: still a shortcut",
      key("ArrowRight", null as never),
      { type: "next" },
    ],
    [
      "on a focused button (the outline): still a shortcut",
      key("ArrowLeft", on("BUTTON")),
      { type: "back" },
    ],
    ["typing in the Ask box: none", key("r", on("INPUT")), null],
    ["in a textarea: none", key("ArrowLeft", on("textarea")), null],
    ["in a select: none", key("ArrowRight", on("SELECT")), null],
    ["on contentEditable: none", key("r", on("DIV", true)), null],
    [
      "with a modifier (Cmd+←, Shift+R): none",
      key("ArrowLeft", on("BODY"), { modified: true }),
      null,
    ],
    [
      "a held key (repeat): none",
      key("ArrowRight", on("BODY"), { repeat: true }),
      null,
    ],
    ["Space is not one of these (usePlayer has it)", key(" "), null],
    ["A is not one of these (the Ask panel has it)", key("a"), null],
  ];
  it.each(cases)("%s", (_, input, expected) => {
    expect(shortcutEvent(input)).toEqual(expected);
  });
});

describe("carryOnEvent (Got it, carry on)", () => {
  it("closeAsk left the lesson paused mid-step: resume", () => {
    expect(carryOnEvent({ kind: "paused", step: 1 })).toEqual({
      type: "resume",
    });
  });
  it("the step had ended (or the lesson finished): stay there", () => {
    expect(carryOnEvent({ kind: "stepEnded", step: 0 })).toBeNull();
    expect(carryOnEvent({ kind: "finished", step: 1 })).toBeNull();
  });
  it("loading (a go_to_step jump, or a step not here yet) or failed: nothing more", () => {
    expect(
      carryOnEvent({ kind: "loading", step: 1, autoplay: false }),
    ).toBeNull();
    expect(carryOnEvent({ kind: "failed", step: 0, message: "x" })).toBeNull();
  });
});
