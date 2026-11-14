"use client";
// The player hook (ARCHITECTURE.md sections 5.3 and 6.1, ROADMAP P5): owns
// the audio element, the clock and the controls, and runs the effects of
// player/machine.ts. The machine decides; this hook only does what it says.
//
// - Each step is loaded by player/stepLoader.ts: the step, then its audio as
//   a blob played from a `blob:` URL (section 5.1).
// - The clock is `audio.currentTime`: read on every animation frame while
//   playing, and on the element's time events otherwise (a seek while
//   paused). The board is `sceneAt(step, t)`, so Back, Replay and seeking
//   are just seeks.
// - Audio plays exactly while the machine is in `playing`. A play or pause
//   from outside the page (media keys, the browser's media controls) is sent
//   to the machine as resume or pause, so the two never disagree.
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { StepResponse } from "@/shared/lesson";
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
  type PlayerEffect,
  type PlayerEvent,
  type PlayerState,
  transition,
  type TransitionResult,
} from "./machine";
import { sceneAt, type TimedAction } from "./sceneAt";
import {
  createStepLoader,
  type FetchStep,
  fetchAudioBlob,
  type LoadedStep,
} from "./stepLoader";

/** The clock reading, tagged with the audio it was read from. */
interface Clock {
  src: string;
  tMs: number;
}

const EMPTY_BOARD: BoardState = { objects: [], copies: [], active: [] };
const NO_TIMED: readonly TimedAction[] = [];

export interface Player {
  state: PlayerState;
  /** The step on screen (0-based) and its count. */
  step: number;
  stepCount: number;
  /** The loaded step on screen, once it has arrived. */
  loaded: StepResponse | null;
  /** The loaded step's timeline (empty until it arrives). */
  timed: readonly TimedAction[];
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
  useEffect(() => {
    ctxRef.current = { stepCount };
    fetchStepRef.current = fetchStep;
  }, [stepCount, fetchStep]);

  // `send`, the effects it runs and the step loader. Built once per mount
  // (state, not a memo, so nothing rebuilds them): they read the refs above,
  // so they never go stale.
  const [core] = useState(() => {
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

    const loader = createStepLoader({
      fetchStep: (n) => fetchStepRef.current(n),
      fetchAudio: fetchAudioBlob,
      createUrl: (blob) => URL.createObjectURL(blob),
      revokeUrl: (url) => URL.revokeObjectURL(url),
      // Keep the step only if the machine takes it, so audio never changes
      // under a state that didn't ask for it.
      ready: (step) => {
        const result = send({ type: "stepReady", i: step.step });
        if (result.outcome === "changed") setLoaded(step);
        else URL.revokeObjectURL(step.src);
      },
      failed: (step, message) => send({ type: "stepFailed", i: step, message }),
      log: console,
    });

    function runEffects(effects: PlayerEffect[]) {
      for (const effect of effects) {
        switch (effect.type) {
          case "loadStep":
            void loader.load(effect.step);
            break;
          case "seekToStart":
            if (audioRef.current) audioRef.current.currentTime = 0;
            break;
          case "restoreBoard":
            // The board is sceneAt(step, tMs) again by itself (the clock
            // stayed at pausedT); the page drops its Ask layer when Ask closes.
            break;
          case "notice":
            break; // shown through `view.notice` in send
        }
      }
    }

    return { send, runEffects, loader };
  });
  const { send } = core;

  // Start: the first state's effects load step 0. Unmounting drops every
  // request in flight.
  useEffect(() => {
    core.runEffects(initialState().effects);
    return () => core.loader.cancel();
  }, [core]);

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
    const next = { src: audio.src, tMs: audio.currentTime * 1000 };
    // Same reading (play pending, stalled): keep the object, skip the render.
    setClock((prev) =>
      prev?.src === next.src && prev.tMs === next.tMs ? prev : next,
    );
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
      const modified = e.shiftKey || e.ctrlKey || e.altKey || e.metaKey;
      if (e.defaultPrevented) return;
      if (!isPlayPauseKey({ key: e.key, repeat: e.repeat, modified, target }))
        return;
      e.preventDefault();
      send(playPauseEvent(stateRef.current));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [send]);

  // A pause from outside the page (media key) while playing: the machine
  // pauses too. The pause that comes with the end of the audio isn't one.
  const onPause = useCallback(() => {
    const audio = audioRef.current;
    if (audio === null || audio.ended) return;
    if (stateRef.current.kind === "playing") send({ type: "pause" });
  }, [send]);

  // A play from outside the page: the machine resumes if it can, and
  // otherwise the audio stops again (no narration over Ask or an ended step).
  const onPlay = useCallback(() => {
    if (stateRef.current.kind === "playing") return;
    if (send({ type: "resume" }).outcome !== "changed")
      audioRef.current?.pause();
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
    timed: onScreen?.timed ?? NO_TIMED,
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
      onPause,
      onPlay,
      onTimeUpdate: readClock,
      onSeeked: readClock,
      onLoadedMetadata: readClock,
      onEmptied: readClock,
    },
  };
}
