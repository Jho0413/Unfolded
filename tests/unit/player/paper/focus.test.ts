// player/paper/focus.ts: which pane is large (issue #98, ARCHITECTURE.md section 5.6).
import { describe, expect, it } from "vitest";
import {
  BOARD_HOLD_MS,
  DEFAULT_FOCUS,
  type FocusEvent,
  focusReducer,
  holdTimer,
  PAPER_HOLD_MS,
  PAPER_MIN_MS,
  USER_HOLD_MS,
} from "@/player/paper/focus";

const run = (...events: FocusEvent[]) =>
  events.reduce(focusReducer, DEFAULT_FOCUS);

describe("focusReducer", () => {
  it("the default: the whiteboard leads", () => {
    expect(DEFAULT_FOCUS.pane).toBe("board");
    expect(run({ type: "tick", atMs: 99_999 })).toBe(DEFAULT_FOCUS);
  });

  it("a paper highlight grows the paper, then the whiteboard leads again", () => {
    const s = run({ type: "paper", atMs: 1000 });
    expect(s).toEqual({
      pane: "paper",
      by: "auto",
      sinceMs: 1000,
      untilMs: 1000 + PAPER_HOLD_MS,
    });
    expect(
      focusReducer(s, { type: "tick", atMs: 1000 + PAPER_HOLD_MS - 1 }).pane,
    ).toBe("paper");
    expect(focusReducer(s, { type: "tick", atMs: 1000 + PAPER_HOLD_MS })).toBe(
      DEFAULT_FOCUS,
    );
  });

  it("the board animating cuts a paper hold short once it has lasted PAPER_MIN_MS", () => {
    expect(
      run({ type: "paper", atMs: 0 }, { type: "board", atMs: PAPER_MIN_MS }),
    ).toEqual({
      pane: "board",
      by: "auto",
      sinceMs: PAPER_MIN_MS,
      untilMs: PAPER_MIN_MS + BOARD_HOLD_MS,
    });
  });

  it("a board action on (or just after) the passage's cue leaves the paper large", () => {
    expect(
      run({ type: "paper", atMs: 0 }, { type: "board", atMs: 0 }).pane,
    ).toBe("paper");
    expect(
      run({ type: "paper", atMs: 0 }, { type: "board", atMs: PAPER_MIN_MS - 1 })
        .pane,
    ).toBe("paper");
  });

  it("otherwise the latest event wins", () => {
    expect(
      run({ type: "board", atMs: 0 }, { type: "paper", atMs: 500 }).pane,
    ).toBe("paper");
  });

  it("a click or hover focuses that pane, and automatic events don't override it meanwhile", () => {
    const s = run(
      { type: "user", pane: "paper", atMs: 0 },
      { type: "board", atMs: 100 },
    );
    expect(s).toMatchObject({
      pane: "paper",
      by: "user",
      untilMs: USER_HOLD_MS,
    });
    expect(
      run(
        { type: "paper", atMs: 0 },
        { type: "user", pane: "board", atMs: 10 },
        { type: "paper", atMs: 20 },
      ).pane,
    ).toBe("board");
  });

  it("after the user's hold, automatic events take over again", () => {
    const s = run(
      { type: "user", pane: "board", atMs: 0 },
      { type: "paper", atMs: USER_HOLD_MS },
    );
    expect(s.pane).toBe("paper");
    expect(
      run(
        { type: "user", pane: "paper", atMs: 0 },
        { type: "tick", atMs: USER_HOLD_MS },
      ),
    ).toBe(DEFAULT_FOCUS);
  });

  it("a later click moves the user's focus", () => {
    expect(
      run(
        { type: "user", pane: "paper", atMs: 0 },
        { type: "user", pane: "board", atMs: 1 },
      ).pane,
    ).toBe("board");
  });

  it("the hold's timer ends it even when setTimeout fires a fraction of a millisecond early", () => {
    const s = run({ type: "paper", atMs: 1000.4 });
    const timer = holdTimer(s, 1000.4)!;
    expect(timer.delayMs).toBe(PAPER_HOLD_MS);
    // setTimeout truncates the fractional delay, so it fires just before untilMs.
    const early = 1000.4 + PAPER_HOLD_MS - 0.4;
    expect(focusReducer(s, timer.tick(early))).toBe(DEFAULT_FOCUS);
    expect(holdTimer(DEFAULT_FOCUS, 0)).toBeNull();
  });
});
