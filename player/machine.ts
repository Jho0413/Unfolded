// The player state machine (ARCHITECTURE.md section 6.1). Pure: no React, no
// audio, no fetch. `transition` maps (state, event) to a result that says
// whether the event changed something, was ignored, was rejected (with a
// message for the learner or the agent tool), or can't happen (treated as
// ignored, with a warning to log). The caller (usePlayer) runs the effects,
// and derives audio play/pause from `state.kind` (e.g. asking pauses the
// narration). It also keeps `pausedT` for `restoreBoard` (time 0 when Ask was
// opened from loading). A "changed" result can return the same state object
// (replay), so key re-renders on the result, not on state identity.

/** Step indexes are 0-based; `stepCount` is the number of steps in the plan. */
export type PlayerContext = { stepCount: number };

/** What Ask was opened from, so closeAsk can go back to it. */
export type AskOrigin =
  | { kind: "playing" | "paused" | "stepEnded" | "finished"; step: number }
  | {
      kind: "loading";
      step: number;
      autoplay: boolean;
      /** Step `step`'s result, if it arrived while Ask was open. */
      arrived?: { ok: true } | { ok: false; message: string };
    };

export type PlayerState =
  | { kind: "loading"; step: number; autoplay: boolean }
  | { kind: "playing"; step: number }
  | { kind: "paused"; step: number }
  | { kind: "stepEnded"; step: number }
  /** After Next on the last step; `step` is the last step. */
  | { kind: "finished"; step: number }
  | { kind: "failed"; step: number; message: string }
  /** `goTo` is a step the agent jumped to, loaded (paused) when Ask closes. */
  | { kind: "asking"; from: AskOrigin; goTo?: number };

export type PlayerEvent =
  | { type: "stepReady"; i: number }
  | { type: "stepFailed"; i: number; message: string }
  | { type: "audioEnded" }
  | { type: "playBlocked" }
  | { type: "audioError" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "replay" }
  | { type: "ask" }
  | { type: "closeAsk" }
  | { type: "agentDisconnected" }
  | { type: "next" }
  | { type: "back" }
  /** `n` is 0-based: the 1-based agent tool (Q4) subtracts 1 first. */
  | { type: "goToStep"; n: number }
  | { type: "retry" };

export type PlayerEventType = PlayerEvent["type"];

/** Side effects for the caller to run, in order. */
export type PlayerEffect =
  /** Request step n (entering loading). Retry is just a new request. */
  | { type: "loadStep"; step: number }
  /** Seek the current step's audio to 0 (replay, or Back on step 0). */
  | { type: "seekToStart" }
  /** Discard the Q&A drawing and show `sceneAt(step, pausedT)` again. */
  | { type: "restoreBoard" }
  /** Tell the learner something (no state of its own). */
  | { type: "notice"; message: string };

export type TransitionResult =
  | { outcome: "changed"; state: PlayerState; effects: PlayerEffect[] }
  /** State unchanged, nothing shown. `log` is set for late replies. */
  | { outcome: "ignored"; state: PlayerState; log?: string }
  /** State unchanged; the learner (or the agent tool) is told `message`. */
  | { outcome: "rejected"; state: PlayerState; message: string }
  /** Treated as ignored (state unchanged); log `warning`. */
  | { outcome: "cantHappen"; state: PlayerState; warning: string };

export const MESSAGES = {
  pressPlay: "Press play to start",
  audioFailed: "Couldn't play the audio. Retry?",
  /** A step request that fails without the server's message (network down, unreadable reply). */
  stepFailed: "Couldn't make this step. Retry?",
  /** `n` is 0-based; the player shows the 1-based step. */
  loading: (n: number) => `Loading step ${n + 1}…`,
  finished: "End of the lesson.",
  qaEnded: "Q&A ended unexpectedly.",
  nothingToAsk: "nothing to ask about",
  /** `n` is 0-based here; the message names the 1-based step the agent tool used. */
  noStep: (n: number) => `no step ${n + 1}`,
} as const;

/** The first state, and its effects: load step 0 with autoplay. */
export function initialState(): {
  state: PlayerState;
  effects: PlayerEffect[];
} {
  return enterLoading(0, true);
}

export function transition(
  state: PlayerState,
  event: PlayerEvent,
  ctx: PlayerContext,
): TransitionResult {
  // Out-of-range goToStep is rejected in every state (section 6.1 bullets).
  if (event.type === "goToStep" && !inPlan(event.n, ctx)) {
    return { outcome: "rejected", state, message: MESSAGES.noStep(event.n) };
  }
  switch (state.kind) {
    case "loading":
      return fromLoading(state, event);
    case "playing":
      return fromPlaying(state, event);
    case "paused":
      return fromPaused(state, event);
    case "stepEnded":
      return fromStepEnded(state, event, ctx);
    case "asking":
      return fromAsking(state, event);
    case "failed":
      return fromFailed(state, event);
    case "finished":
      return fromFinished(state, event);
  }
}

/** Logs what a result says to log: late replies and can't-happen warnings. */
export function logResult(
  result: TransitionResult,
  logger: Pick<Console, "info" | "warn"> = console,
): void {
  if (result.outcome === "cantHappen")
    logger.warn(`[player] ${result.warning}`);
  else if (result.outcome === "ignored" && result.log)
    logger.info(`[player] ${result.log}`);
}

// ---------------------------------------------------------------- helpers

function inPlan(n: number, ctx: PlayerContext): boolean {
  return Number.isInteger(n) && n >= 0 && n < ctx.stepCount;
}

function changed(
  state: PlayerState,
  effects: PlayerEffect[] = [],
): TransitionResult {
  return { outcome: "changed", state, effects };
}

function ignored(state: PlayerState, log?: string): TransitionResult {
  return log === undefined
    ? { outcome: "ignored", state }
    : { outcome: "ignored", state, log };
}

function cantHappen(state: PlayerState, warning: string): TransitionResult {
  return {
    outcome: "cantHappen",
    state,
    warning: `${warning} (event in ${state.kind})`,
  };
}

function enterLoading(
  step: number,
  autoplay: boolean,
  effects: PlayerEffect[] = [],
): { state: PlayerState; effects: PlayerEffect[] } {
  return {
    state: { kind: "loading", step, autoplay },
    effects: [...effects, { type: "loadStep", step }],
  };
}

function toLoading(
  step: number,
  autoplay: boolean,
  effects: PlayerEffect[] = [],
): TransitionResult {
  const next = enterLoading(step, autoplay, effects);
  return changed(next.state, next.effects);
}

function lateReply(state: PlayerState, i: number): TransitionResult {
  return ignored(state, `late reply for step ${i} ignored`);
}

/** Back from a step that has audio: previous step, or replay on step 0. */
function backWithAudio(step: number): TransitionResult {
  return step === 0
    ? changed({ kind: "playing", step }, [{ type: "seekToStart" }])
    : toLoading(step - 1, true);
}

// ---------------------------------------------------------------- states

function fromLoading(
  state: Extract<PlayerState, { kind: "loading" }>,
  event: PlayerEvent,
): TransitionResult {
  switch (event.type) {
    case "stepReady":
      if (event.i !== state.step) return lateReply(state, event.i);
      return changed({
        kind: state.autoplay ? "playing" : "paused",
        step: state.step,
      });
    case "stepFailed":
      if (event.i !== state.step) return lateReply(state, event.i);
      return changed({
        kind: "failed",
        step: state.step,
        message: event.message,
      });
    case "audioEnded":
    case "playBlocked":
    case "audioError":
      return cantHappen(state, `${event.type}: no audio while loading`);
    case "ask":
      return changed({
        kind: "asking",
        from: { kind: "loading", step: state.step, autoplay: state.autoplay },
      });
    case "closeAsk":
    case "agentDisconnected":
      return cantHappen(state, `${event.type}: not asking`);
    case "goToStep":
      return toLoading(event.n, true);
    case "pause":
    case "resume":
    case "replay":
    case "next":
    case "back":
    case "retry":
      return ignored(state);
  }
}

function fromPlaying(
  state: Extract<PlayerState, { kind: "playing" }>,
  event: PlayerEvent,
): TransitionResult {
  const { step } = state;
  switch (event.type) {
    case "stepReady":
    case "stepFailed":
      return lateReply(state, event.i);
    case "audioEnded":
      return changed({ kind: "stepEnded", step });
    case "playBlocked":
      return changed({ kind: "paused", step }, [
        { type: "notice", message: MESSAGES.pressPlay },
      ]);
    case "audioError":
      return changed({ kind: "failed", step, message: MESSAGES.audioFailed });
    case "pause":
      return changed({ kind: "paused", step });
    case "replay":
      return changed(state, [{ type: "seekToStart" }]);
    case "ask":
      return changed({ kind: "asking", from: { kind: "playing", step } });
    case "closeAsk":
    case "agentDisconnected":
      return cantHappen(state, `${event.type}: not asking`);
    case "back":
      return backWithAudio(step);
    case "goToStep":
      return toLoading(event.n, true);
    case "resume":
    case "next":
    case "retry":
      return ignored(state);
  }
}

function fromPaused(
  state: Extract<PlayerState, { kind: "paused" }>,
  event: PlayerEvent,
): TransitionResult {
  const { step } = state;
  switch (event.type) {
    case "stepReady":
    case "stepFailed":
      return lateReply(state, event.i);
    case "audioEnded":
      return cantHappen(state, "audioEnded: audio stopped");
    case "playBlocked":
      return cantHappen(state, "playBlocked: not trying to play");
    case "resume":
      return changed({ kind: "playing", step });
    case "replay":
      return changed({ kind: "playing", step }, [{ type: "seekToStart" }]);
    case "ask":
      return changed({ kind: "asking", from: { kind: "paused", step } });
    case "closeAsk":
    case "agentDisconnected":
      return cantHappen(state, `${event.type}: not asking`);
    case "back":
      return backWithAudio(step);
    case "goToStep":
      return toLoading(event.n, true);
    case "audioError":
    case "pause":
    case "next":
    case "retry":
      return ignored(state);
  }
}

function fromStepEnded(
  state: Extract<PlayerState, { kind: "stepEnded" }>,
  event: PlayerEvent,
  ctx: PlayerContext,
): TransitionResult {
  const { step } = state;
  switch (event.type) {
    case "stepReady":
    case "stepFailed":
      return lateReply(state, event.i);
    case "audioEnded":
      return cantHappen(state, "audioEnded: audio already ended");
    case "playBlocked":
      return cantHappen(state, "playBlocked: not trying to play");
    case "replay":
      return changed({ kind: "playing", step }, [{ type: "seekToStart" }]);
    case "ask":
      return changed({ kind: "asking", from: { kind: "stepEnded", step } });
    case "closeAsk":
    case "agentDisconnected":
      return cantHappen(state, `${event.type}: not asking`);
    case "next":
      return step >= ctx.stepCount - 1
        ? changed({ kind: "finished", step })
        : toLoading(step + 1, true);
    case "back":
      return backWithAudio(step);
    case "goToStep":
      return toLoading(event.n, true);
    case "audioError":
    case "pause":
    case "resume":
    case "retry":
      return ignored(state);
  }
}

function fromAsking(
  state: Extract<PlayerState, { kind: "asking" }>,
  event: PlayerEvent,
): TransitionResult {
  const { from } = state;
  switch (event.type) {
    case "stepReady":
    case "stepFailed": {
      if (from.kind !== "loading" || event.i !== from.step)
        return lateReply(state, event.i);
      const arrived =
        event.type === "stepReady"
          ? ({ ok: true } as const)
          : ({ ok: false, message: event.message } as const);
      return changed({ ...state, from: { ...from, arrived } });
    }
    case "audioEnded":
      return cantHappen(state, "audioEnded: narration paused");
    case "playBlocked":
      return cantHappen(state, "playBlocked: narration paused");
    case "closeAsk":
      return closeAsk(state, []);
    case "agentDisconnected":
      return closeAsk(state, [{ type: "notice", message: MESSAGES.qaEnded }]);
    case "goToStep":
      return changed({ ...state, goTo: event.n });
    case "audioError":
    case "pause":
    case "resume":
    case "replay":
    case "ask":
    case "next":
    case "back":
    case "retry":
      return ignored(state);
  }
}

function closeAsk(
  state: Extract<PlayerState, { kind: "asking" }>,
  notices: PlayerEffect[],
): TransitionResult {
  const effects: PlayerEffect[] = [{ type: "restoreBoard" }, ...notices];
  // The agent jumped: load that step paused, so narration never talks over it.
  if (state.goTo !== undefined) return toLoading(state.goTo, false, effects);
  const { from } = state;
  switch (from.kind) {
    case "playing":
    case "paused":
      return changed({ kind: "paused", step: from.step }, effects);
    case "stepEnded":
    case "finished":
      return changed({ kind: from.kind, step: from.step }, effects);
    case "loading":
      if (from.arrived === undefined)
        // Still on its way: the request is in flight, so don't request again.
        return changed(
          { kind: "loading", step: from.step, autoplay: from.autoplay },
          effects,
        );
      return from.arrived.ok
        ? changed({ kind: "paused", step: from.step }, effects)
        : changed(
            { kind: "failed", step: from.step, message: from.arrived.message },
            effects,
          );
  }
}

function fromFailed(
  state: Extract<PlayerState, { kind: "failed" }>,
  event: PlayerEvent,
): TransitionResult {
  const { step } = state;
  switch (event.type) {
    case "stepReady":
    case "stepFailed":
      return lateReply(state, event.i);
    case "audioEnded":
    case "playBlocked":
    case "audioError":
      return cantHappen(state, `${event.type}: no audio after a failure`);
    case "ask":
      return {
        outcome: "rejected",
        state,
        message: MESSAGES.nothingToAsk,
      };
    case "closeAsk":
    case "agentDisconnected":
      return cantHappen(state, `${event.type}: not asking`);
    case "back":
      return step === 0 ? ignored(state) : toLoading(step - 1, true);
    case "goToStep":
      return toLoading(event.n, true);
    case "retry":
      return toLoading(step, true);
    case "pause":
    case "resume":
    case "replay":
    case "next":
      return ignored(state);
  }
}

function fromFinished(
  state: Extract<PlayerState, { kind: "finished" }>,
  event: PlayerEvent,
): TransitionResult {
  const { step } = state;
  switch (event.type) {
    case "stepReady":
    case "stepFailed":
      return lateReply(state, event.i);
    case "audioEnded":
      return cantHappen(state, "audioEnded: lesson finished");
    case "playBlocked":
      return cantHappen(state, "playBlocked: not trying to play");
    case "replay":
      return changed({ kind: "playing", step }, [{ type: "seekToStart" }]);
    case "ask":
      return changed({ kind: "asking", from: { kind: "finished", step } });
    case "closeAsk":
    case "agentDisconnected":
      return cantHappen(state, `${event.type}: not asking`);
    case "back":
      return toLoading(step, true);
    case "goToStep":
      return toLoading(event.n, true);
    case "audioError":
    case "pause":
    case "resume":
    case "next":
    case "retry":
      return ignored(state);
  }
}
