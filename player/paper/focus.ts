// Which pane is large, the whiteboard or the paper (issue #98, ARCHITECTURE.md section 5.6).
// Pure: the lesson page sends the events and draws the result.
//
// - A paper highlight (a narration cue or highlight_paper) grows the paper for PAPER_HOLD_MS.
// - The board starting to animate (a lesson action, or a sketch arriving during Ask) grows the
//   whiteboard for BOARD_HOLD_MS, cutting a paper hold short once it has lasted PAPER_MIN_MS
//   (a step's actions often start on the same cue as its passage, and the learner should still
//   see the passage). Otherwise the latest event wins.
// - A click or hover on a pane focuses it for USER_HOLD_MS, and nothing automatic overrides
//   that meanwhile.
// - Once a hold ends, the whiteboard leads again (the default).

export type Pane = "board" | "paper";

export type FocusState = {
  pane: Pane;
  by: "default" | "auto" | "user";
  /** When the hold started and ends (ms, the caller's clock); unused for the default. */
  sinceMs: number;
  untilMs: number;
};

export type FocusEvent =
  | { type: "paper"; atMs: number }
  | { type: "board"; atMs: number }
  | { type: "user"; pane: Pane; atMs: number }
  /** Time passed: a hold that has ended goes back to the default. */
  | { type: "tick"; atMs: number };

export const PAPER_HOLD_MS = 6000;
export const PAPER_MIN_MS = 2500;
export const BOARD_HOLD_MS = 4000;
export const USER_HOLD_MS = 8000;

export const DEFAULT_FOCUS: FocusState = {
  pane: "board",
  by: "default",
  sinceMs: 0,
  untilMs: 0,
};

export function focusReducer(state: FocusState, event: FocusEvent): FocusState {
  const { atMs } = event;
  const held = atMs < state.untilMs;
  const userHold = state.by === "user" && held;
  const freshPaper =
    state.by === "auto" &&
    state.pane === "paper" &&
    held &&
    atMs < state.sinceMs + PAPER_MIN_MS;
  const hold = (pane: Pane, by: "auto" | "user", ms: number): FocusState => ({
    pane,
    by,
    sinceMs: atMs,
    untilMs: atMs + ms,
  });
  switch (event.type) {
    case "user":
      return hold(event.pane, "user", USER_HOLD_MS);
    case "paper":
      return userHold ? state : hold("paper", "auto", PAPER_HOLD_MS);
    case "board":
      return userHold || freshPaper
        ? state
        : hold("board", "auto", BOARD_HOLD_MS);
    case "tick":
      return state.by !== "default" && !held ? DEFAULT_FOCUS : state;
  }
}
