"use client";
// The player hook (ARCHITECTURE.md sections 5.3 and 6.1, ROADMAP P5): owns
// the audio element, the clock and the controls, and runs the effects of
// player/machine.ts. The machine decides; this hook only does what it says.
//
// - Each step's audio is fetched as a blob and played from a `blob:` URL, so
//   seeking works without HTTP Range support (section 5.1).
// - The clock is `audio.currentTime`: read on every animation frame while
//   playing, and on the element's time events otherwise (a seek while
//   paused). The board is `sceneAt(step, t)`, so Back, Replay and seeking
//   are just seeks.
// - Audio plays exactly while the machine is in `playing`.
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ApiError, StepResponse } from "@/shared/lesson";
import type { BoardState } from "@/shared/scene";
import {
  canSend,
  isPlayPauseKey,
  lastFiredCue,
  playPauseEvent,
  playRejectionEvent,
  stepOnScreen,
} from "./controls";
import {
  initialState,
  logResult,
  MESSAGES,
  type PlayerEffect,
  type PlayerEvent,
  type PlayerState,
  transition,
  type TransitionResult,
} from "./machine";
import { sceneAt, type TimedAction, timeline } from "./sceneAt";

/**
 * Requests step `n` (0-based). Resolves to the step, or to the server's
 * error body, whose message the learner sees. A rejection (network down) is
 * logged and shown as `MESSAGES.stepFailed`. The caller validates the
 * response at its boundary.
 */
export type FetchStep = (n: number) => Promise<StepResponse | ApiError>;

/** A step whose script and audio have both arrived. */
interface LoadedStep {
  step: number;
  response: StepResponse;
  timed: TimedAction[];
  /** The audio as a `blob:` URL, revoked when another step replaces it. */
  src: string;
}

/** The clock reading, tagged with the audio it was read from. */
interface Clock {
  src: string;
  tMs: number;
}

const EMPTY_BOARD: BoardState = { objects: [], copies: [], active: [] };

export interface Player {
  state: PlayerState;
  /** The step on screen (0-based) and its count. */
  step: number;
  stepCount: number;
  /** The loaded step on screen, once it has arrived. */
  loaded: StepResponse | null;
  board: BoardState;
  /** Audio time of the step on screen, in ms. */
  tMs: number;
  /** The last cue fired by `tMs`, for the debug overlay. */
  lastCue: string | null;
  /** A message for the learner ("Press play to start"), until the next change. */
  notice: string | null;
  /** Sends an event to the machine and runs its effects. */
  send: (event: PlayerEvent) => TransitionResult;
  /** Whether an event would change the player now (enables the controls). */
  can: (event: PlayerEvent) => boolean;
  /** Spread onto the one `<audio>` element. */
  audioProps: ComponentProps<"audio">;
}

export function usePlayer({
  stepCount,
  fetchStep,
}: {
  stepCount: number;
  fetchStep: FetchStep;
}): Player {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [view, setView] = useState<{
    state: PlayerState;
    notice: string | null;
  }>(() => ({ state: initialState().state, notice: null }));
  const [loaded, setLoaded] = useState<LoadedStep | null>(null);
  const [clock, setClock] = useState<Clock | null>(null);

  // Read by `send`, which runs outside render (handlers, async loads).
  const stateRef = useRef(view.state);
  const ctxRef = useRef({ stepCount });
  const fetchStepRef = useRef(fetchStep);
  /** Only the latest step request may change the player: older ones are late replies. */
  const requestRef = useRef(0);
  useEffect(() => {
    ctxRef.current = { stepCount };
    fetchStepRef.current = fetchStep;
  }, [stepCount, fetchStep]);

  // `send` and the effects it runs. Built once: they read the refs above, so
  // they never go stale.
  const { send, runEffects } = useMemo(() => {
    function send(event: PlayerEvent): TransitionResult {
      const result = transition(stateRef.current, event, ctxRef.current);
      logResult(result);
      if (result.outcome === "rejected") {
        setView((v) => ({ ...v, notice: result.message }));
      } else if (result.outcome === "changed") {
        stateRef.current = result.state;
        const notice = result.effects.find((e) => e.type === "notice");
        setView({ state: result.state, notice: notice?.message ?? null });
        runEffects(result.effects);
      }
      return result;
    }

    function runEffects(effects: PlayerEffect[]) {
      for (const effect of effects) {
        switch (effect.type) {
          case "loadStep":
            void load(effect.step);
            break;
          case "seekToStart":
            if (audioRef.current) audioRef.current.currentTime = 0;
            break;
          case "restoreBoard":
            // Nothing to restore yet: the Q&A drawing arrives with Q3.
            break;
          case "notice":
            break; // shown through `view.notice` in send
        }
      }
    }

    async function load(step: number) {
      const request = ++requestRef.current;
      const stale = () => request !== requestRef.current;
      let response: StepResponse;
      try {
        const reply = await fetchStepRef.current(step);
        if ("error" in reply) {
          if (!stale())
            send({ type: "stepFailed", i: step, message: reply.error });
          return;
        }
        response = reply;
      } catch (error) {
        console.error(`[player] step ${step} request failed`, error);
        if (!stale())
          send({ type: "stepFailed", i: step, message: MESSAGES.stepFailed });
        return;
      }
      let src: string;
      try {
        const audio = await fetch(response.audioUrl);
        if (!audio.ok) throw new Error(`HTTP ${audio.status}`);
        src = URL.createObjectURL(await audio.blob());
      } catch (error) {
        console.error(`[player] step ${step} audio failed to load`, error);
        if (!stale())
          send({ type: "stepFailed", i: step, message: MESSAGES.audioFailed });
        return;
      }
      if (stale()) {
        // A newer request replaced this one (the machine moved on).
        URL.revokeObjectURL(src);
        console.info(`[player] late reply for step ${step} ignored`);
        return;
      }
      const timed = timeline(response.step.actions, response.cueTimes);
      setLoaded({ step, response, timed, src });
      send({ type: "stepReady", i: step });
    }

    return { send, runEffects };
  }, []);

  // Start: the first state's effects load step 0. Unmounting makes every
  // request in flight stale.
  useEffect(() => {
    runEffects(initialState().effects);
    const requests = requestRef;
    return () => {
      requests.current++;
    };
  }, [runEffects]);

  // Free each step's audio once another step replaces it, and on unmount.
  const src = loaded?.src;
  useEffect(() => {
    if (src === undefined) return;
    return () => URL.revokeObjectURL(src);
  }, [src]);

  // Audio plays exactly while the machine is in `playing`.
  const kind = view.state.kind;
  useEffect(() => {
    const audio = audioRef.current;
    if (audio === null || src === undefined) return;
    if (kind !== "playing") {
      audio.pause();
      return;
    }
    // An element that already failed to decode (while paused, where the
    // machine ignores audioError) can't play.
    if (audio.error !== null) {
      send({ type: "audioError" });
      return;
    }
    audio.play().catch((error: unknown) => {
      const event = playRejectionEvent(error);
      if (event !== null) send(event);
    });
  }, [kind, src, send]);

  const readClock = useCallback(() => {
    const audio = audioRef.current;
    if (audio === null || audio.src === "") return;
    setClock({ src: audio.src, tMs: audio.currentTime * 1000 });
  }, []);

  // The clock while playing: one reading per animation frame.
  useEffect(() => {
    if (kind !== "playing") return;
    let frame = requestAnimationFrame(function tick() {
      readClock();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [kind, readClock]);

  // Space plays and pauses (ARCHITECTURE.md section 8: `A` is kept for Ask).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (!isPlayPauseKey({ key: e.key, repeat: e.repeat, target })) return;
      e.preventDefault();
      send(playPauseEvent(stateRef.current));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [send]);

  const step = stepOnScreen(view.state);
  const onScreen = loaded !== null && loaded.step === step ? loaded : null;
  const tMs = onScreen !== null && clock?.src === onScreen.src ? clock.tMs : 0;
  const board = useMemo(
    () =>
      onScreen === null
        ? EMPTY_BOARD
        : sceneAt(onScreen.response.step.objects, onScreen.timed, tMs),
    [onScreen, tMs],
  );
  const state = view.state;
  const can = useCallback(
    (event: PlayerEvent) => canSend(state, event, { stepCount }),
    [state, stepCount],
  );

  return {
    state,
    step,
    stepCount,
    loaded: onScreen?.response ?? null,
    board,
    tMs,
    lastCue:
      onScreen === null
        ? null
        : lastFiredCue(
            onScreen.response.step.actions,
            onScreen.response.cueTimes,
            tMs,
          ),
    notice: view.notice,
    send,
    can,
    audioProps: {
      ref: audioRef,
      src,
      preload: "auto",
      onEnded: () => send({ type: "audioEnded" }),
      onError: () => send({ type: "audioError" }),
      onTimeUpdate: readClock,
      onSeeked: readClock,
      onLoadedMetadata: readClock,
      onEmptied: readClock,
    },
  };
}
