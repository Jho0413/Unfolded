// The pure helpers behind usePlayer and the controls (player/controls.ts,
// ROADMAP P5). The hook itself is driven in a browser by
// tests/e2e/player.spec.ts and player-autoplay.spec.ts.
import { describe, expect, it } from "vitest";
import {
  canSend,
  afterAskEvent,
  commandEvent,
  type AskClose,
  isTextEntry,
  isPlayPauseKey,
  isOutsidePlay,
  lastFiredCue,
  outsidePauseEvent,
  playPauseEvent,
  playRejectionEvent,
  shortcutEvent,
  stepOnScreen,
} from "@/player/controls";
import type { AskOrigin, PlayerState } from "@/player/machine";
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

describe("the element's pause and play events (a media key, or a late event, #139)", () => {
  const playing: PlayerState = { kind: "playing", step: 0 };
  const paused: PlayerState = { kind: "paused", step: 0 };
  const stopped = { paused: true, ended: false };
  const running = { paused: false, ended: false };
  const ended = { paused: true, ended: true };

  it.each([
    [
      "a media key pause while explaining: pause",
      stopped,
      playing,
      { type: "pause" },
    ],
    ["the pause at the end of the audio: nothing", ended, playing, null],
    [
      "a late pause, the element playing again (Space twice quickly): nothing",
      running,
      playing,
      null,
    ],
    ["a pause while held on already: nothing", stopped, paused, null],
  ] as const)("outsidePauseEvent: %s", (_, media, state, event) => {
    expect(outsidePauseEvent(media, state)).toEqual(event);
  });

  it.each([
    ["a media key play while held on: resume", running, paused, true],
    ["a play while already explaining: nothing", running, playing, false],
    [
      "a late play, the element paused again since: nothing",
      stopped,
      paused,
      false,
    ],
  ] as const)("isOutsidePlay: %s", (_, media, state, outside) => {
    expect(isOutsidePlay(media, state)).toBe(outside);
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

describe("isTextEntry (where keys are typing, not shortcuts)", () => {
  const cases: [string, Parameters<typeof isTextEntry>[0], boolean][] = [
    ["an input", { tagName: "INPUT", isContentEditable: false }, true],
    [
      "a textarea (any case)",
      { tagName: "textarea", isContentEditable: false },
      true,
    ],
    ["a select", { tagName: "SELECT", isContentEditable: false }, true],
    ["contentEditable", { tagName: "DIV", isContentEditable: true }, true],
    ["a button", { tagName: "BUTTON", isContentEditable: false }, false],
    ["the page", { tagName: "BODY", isContentEditable: false }, false],
    ["no target", null, false],
  ];
  it.each(cases)("%s → %s", (_, target, expected) => {
    expect(isTextEntry(target)).toBe(expected);
  });
});

// ARCHITECTURE.md section 5.6, closing Ask: one test per row.
describe("afterAskEvent (what closing Ask goes on with)", () => {
  const resume = { type: "resume" };
  const paused = (step = 0): PlayerState => ({ kind: "paused", step });
  type Row = [string, AskClose, AskOrigin, PlayerState, unknown];
  const rows: Row[] = [
    [
      "Got it, carry on, after explaining: resume",
      "carryOn",
      { kind: "playing", step: 0 },
      paused(),
      resume,
    ],
    [
      "Got it, carry on, after Hold on: resume",
      "carryOn",
      { kind: "paused", step: 0 },
      paused(),
      resume,
    ],
    [
      "Got it, carry on, opened while loading, the step arrived: resume",
      "carryOn",
      { kind: "loading", step: 0, autoplay: true, arrived: { ok: true } },
      paused(),
      resume,
    ],
    [
      "Got it, carry on, after the step ended: stay on its Next prompt",
      "carryOn",
      { kind: "stepEnded", step: 0 },
      { kind: "stepEnded", step: 0 },
      null,
    ],
    [
      "Got it, carry on, after the lesson finished: stay",
      "carryOn",
      { kind: "finished", step: 1 },
      { kind: "finished", step: 1 },
      null,
    ],
    [
      "Got it, carry on, after a go_to_step jump: it loads paused, nothing more",
      "carryOn",
      { kind: "playing", step: 0 },
      { kind: "loading", step: 1, autoplay: false },
      null,
    ],
    [
      "Got it, carry on, the step still loading: nothing more",
      "carryOn",
      { kind: "loading", step: 0, autoplay: true },
      { kind: "loading", step: 0, autoplay: true },
      null,
    ],
    [
      "Got it, carry on, the step failed meanwhile: nothing more",
      "carryOn",
      {
        kind: "loading",
        step: 0,
        autoplay: true,
        arrived: { ok: false, message: "x" },
      },
      { kind: "failed", step: 0, message: "x" },
      null,
    ],
    [
      "dismissed (Escape, agent ended) after explaining: resume",
      "dismiss",
      { kind: "playing", step: 0 },
      paused(),
      resume,
    ],
    [
      "dismissed after Hold on: stay held",
      "dismiss",
      { kind: "paused", step: 0 },
      paused(),
      null,
    ],
    [
      "dismissed after the step ended: stay on its Next prompt",
      "dismiss",
      { kind: "stepEnded", step: 0 },
      { kind: "stepEnded", step: 0 },
      null,
    ],
    [
      "dismissed, opened while loading to autoplay, the step arrived: play it",
      "dismiss",
      { kind: "loading", step: 0, autoplay: true, arrived: { ok: true } },
      paused(),
      resume,
    ],
    [
      "dismissed, opened while loading a jump (no autoplay), the step arrived: stay",
      "dismiss",
      { kind: "loading", step: 1, autoplay: false, arrived: { ok: true } },
      paused(1),
      null,
    ],
    [
      "dismissed after a go_to_step jump: it loads paused",
      "dismiss",
      { kind: "playing", step: 0 },
      { kind: "loading", step: 1, autoplay: false },
      null,
    ],
  ];
  it.each(rows)("%s", (_, how, origin, afterClose, expected) => {
    expect(afterAskEvent(how, origin, afterClose)).toEqual(expected);
  });
});

describe("commandEvent (spoken commands, issue #93: existing events only)", () => {
  const three = { stepCount: 3 };
  const rows: [
    string,
    Parameters<typeof commandEvent>[0],
    PlayerState,
    unknown,
  ][] = [
    [
      "resume while held on",
      "resume",
      { kind: "paused", step: 1 },
      { type: "resume" },
    ],
    [
      "resume while explaining: nothing",
      "resume",
      { kind: "playing", step: 1 },
      null,
    ],
    [
      "resume at the end of a step: the next step",
      "resume",
      { kind: "stepEnded", step: 0 },
      { type: "next" },
    ],
    [
      "resume at the end of the last step: finished",
      "resume",
      { kind: "stepEnded", step: 2 },
      { type: "next" },
    ],
    [
      "resume after the lesson: nothing",
      "resume",
      { kind: "finished", step: 2 },
      null,
    ],
    [
      "pause while explaining",
      "pause",
      { kind: "playing", step: 1 },
      { type: "pause" },
    ],
    [
      "pause while held on: nothing",
      "pause",
      { kind: "paused", step: 1 },
      null,
    ],
    [
      "next mid-step: a jump that starts",
      "next",
      { kind: "playing", step: 0 },
      { type: "goToStep", n: 1 },
    ],
    [
      "next while held on: a jump",
      "next",
      { kind: "paused", step: 1 },
      { type: "goToStep", n: 2 },
    ],
    [
      "next mid-step on the last step: nothing",
      "next",
      { kind: "playing", step: 2 },
      null,
    ],
    [
      "next at the end of a step",
      "next",
      { kind: "stepEnded", step: 0 },
      { type: "next" },
    ],
    [
      "next at the end of the last step: finished",
      "next",
      { kind: "stepEnded", step: 2 },
      { type: "next" },
    ],
    [
      "next after a failed step skips it",
      "next",
      { kind: "failed", step: 0, message: "x" },
      { type: "next" },
    ],
    ["previous", "previous", { kind: "playing", step: 2 }, { type: "back" }],
    [
      "previous on step 0 starts it again",
      "previous",
      { kind: "paused", step: 0 },
      { type: "back" },
    ],
    ["replay", "replay", { kind: "stepEnded", step: 1 }, { type: "replay" }],
    [
      "replay after the lesson",
      "replay",
      { kind: "finished", step: 2 },
      { type: "replay" },
    ],
    [
      "anything while loading: nothing",
      "replay",
      { kind: "loading", step: 1, autoplay: true },
      null,
    ],
  ];
  it.each(rows)("%s", (_, command, state, event) => {
    expect(commandEvent(command, state, three)).toEqual(event);
  });
});
