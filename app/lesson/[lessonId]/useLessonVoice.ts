"use client";
// The lesson's always-on voice (issue #93, ARCHITECTURE.md section 8), apart from LessonAsk:
//
// - `live`: when the lesson wants its voice session (qa/connector.ts setLive). From the first
//   time the lesson plays (the Start press, which is also the user gesture the browser wants for
//   audio and the mic prompt) until the lesson ends, or while the tab has been hidden for more
//   than AWAY_MS. An open session bills ElevenLabs minutes, so it isn't kept for nothing.
// - `control`: carries out a spoken command (the agent's control tools, qa/tools.ts) with
//   `controlLesson`: an existing machine event (player/controls.ts commandEvent), after closing
//   Ask if it's open. "Carry on" closes Ask like the card's "Got it, carry on" (closeAsk, then
//   afterAskEvent); after a go_to_step jump, the step it loads (paused) starts once it arrives.
//   "Hold on" while asking closes Ask only from the Answer view (see controlLesson).
import { useCallback, useEffect, useRef, useState } from "react";
import {
  afterAskEvent,
  commandEvent,
  type LessonCommand,
} from "@/player/controls";
import type {
  PlayerContext,
  PlayerEvent,
  PlayerState,
  TransitionResult,
} from "@/player/machine";
import type { Player } from "@/player/usePlayer";
import type { AskSession } from "@/qa/askSession";

/** A tab hidden this long ends the lesson's voice session (it reopens when the tab is back). */
export const AWAY_MS = 120_000;

/** Whether the lesson's voice session should be open. */
export function wantsVoice({
  started,
  away,
  state,
  stepCount,
}: {
  started: boolean;
  away: boolean;
  state: PlayerState;
  stepCount: number;
}): boolean {
  if (!started || away) return false;
  // Ask keeps what it was opened from: the lesson's end is the end either way.
  const at = state.kind === "asking" ? state.from : state;
  const ended =
    at.kind === "finished" ||
    (at.kind === "stepEnded" && at.step === stepCount - 1);
  return !ended;
}

/**
 * Carries out a spoken command. While asking, Ask closes first (session, then `closeAsk`), except
 * for pause_lesson: the lesson is already held during Ask, so "hold on" there closes Ask (back to
 * the lesson, held) only from the Answer view (a bare "go back" in the prompt, section 8). With no
 * Answer view (a sketch still in flight, the agent still explaining) it does nothing: the agent
 * calling it on its own once dropped the sketch mid-answer (board comment 6887751495).
 */
export function controlLesson(
  command: LessonCommand,
  deps: {
    state: PlayerState;
    ctx: PlayerContext;
    send: (event: PlayerEvent) => TransitionResult;
    closeSession: () => void;
    /** Whether a drawn answer has replaced the lesson board (#94); false without one. */
    isAnswerShowing?: () => boolean;
    /** A step to start once it has loaded (after a go_to_step jump). */
    playWhenReady: (step: number) => void;
  },
): void {
  const { state: now, ctx, send } = deps;
  if (now.kind !== "asking") {
    const event = commandEvent(command, now, ctx);
    if (event !== null) send(event);
    return;
  }
  if (command === "pause" && !(deps.isAnswerShowing?.() ?? false)) return;
  deps.closeSession();
  const closed = send({ type: "closeAsk" });
  if (closed.outcome !== "changed") return;
  if (command === "resume") {
    // As the card's "Got it, carry on" (section 5.6). After a go_to_step jump, closeAsk
    // loads that step paused: start it once it's here.
    if (now.goTo !== undefined) deps.playWhenReady(now.goTo);
    const next = afterAskEvent("carryOn", now.from, closed.state);
    if (next !== null) send(next);
    return;
  }
  const event = commandEvent(command, closed.state, ctx);
  if (event !== null) send(event);
}

export function useLessonVoice({
  player,
  session,
  isAnswerShowing,
}: {
  player: Player;
  session: AskSession;
  /** Whether the Answer view is up (#94 wires it); "hold on" while asking needs it. */
  isAnswerShowing?: () => boolean;
}): { live: boolean; control: (command: LessonCommand) => void } {
  const { state, send, stepCount } = player;

  // Started: the lesson has played once (derived during render, not in an effect).
  const [started, setStarted] = useState(false);
  if (!started && state.kind === "playing") setStarted(true);

  const [away, setAway] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onVisibility = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (document.visibilityState === "hidden")
        timer = setTimeout(() => setAway(true), AWAY_MS);
      else setAway(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // A step a "carry on" should start once it has loaded (after a go_to_step jump).
  const playWhenReady = useRef<number | null>(null);
  useEffect(() => {
    const want = playWhenReady.current;
    if (want === null) return;
    if (state.kind === "paused" && state.step === want) {
      playWhenReady.current = null;
      send({ type: "resume" });
    } else if (!(state.kind === "loading" && state.step === want)) {
      playWhenReady.current = null; // the learner went elsewhere
    }
  }, [state, send]);

  const control = useCallback(
    (command: LessonCommand) =>
      controlLesson(command, {
        state: stateRef.current,
        ctx: { stepCount },
        send,
        closeSession: () => session.close(),
        isAnswerShowing,
        playWhenReady: (step) => (playWhenReady.current = step),
      }),
    [session, send, stepCount, isAnswerShowing],
  );

  return {
    live: wantsVoice({ started, away, state, stepCount }),
    control,
  };
}
