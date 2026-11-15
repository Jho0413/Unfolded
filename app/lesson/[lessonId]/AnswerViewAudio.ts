// Plays a narrated answer's audio (#105, ARCHITECTURE.md section 5.6) as the player plays a step:
// the audio is a `blob:` URL, and the clock is its `currentTime`, so the drawing is
// `sceneAt(answer, clock)` and a pause, a replay or the end are just the audio stopping or
// seeking. ./AnswerViewPlayback.ts decides; this only does what it says. No React: the lesson
// page makes one per Ask session, and tests give it a fake audio element.
import {
  type AnswerEvent,
  type AnswerOutcome,
  type AnswerPlayback,
  answerTransition,
} from "./AnswerViewPlayback";

/** The part of an HTMLAudioElement the answer uses. */
export type AnswerAudio = Pick<
  HTMLAudioElement,
  "currentTime" | "play" | "pause" | "addEventListener" | "removeEventListener"
>;

export type AnswerPlayerDeps = {
  createAudio?: (src: string) => AnswerAudio;
  createUrl?: (blob: Blob) => string;
  revokeUrl?: (url: string) => void;
  log?: Pick<Console, "warn">;
  /** Called on every change, so the page can redraw (e.g. the card). */
  onChange?: () => void;
};

type Playing = {
  audio: AnswerAudio | null;
  url: string | null;
  state: AnswerPlayback;
  /** Resolves the first playback's outcome; null once it has. */
  settle: ((outcome: AnswerOutcome) => void) | null;
  detach: () => void;
};

export type AnswerPlayer = ReturnType<typeof createAnswerPlayer>;

export function createAnswerPlayer(deps: AnswerPlayerDeps = {}) {
  const createAudio = deps.createAudio ?? ((src: string) => new Audio(src));
  const createUrl =
    deps.createUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeUrl =
    deps.revokeUrl ?? ((url: string) => URL.revokeObjectURL(url));
  const log = deps.log ?? console;
  let current: Playing | null = null;

  const tMs = (p: Playing) => (p.audio ? p.audio.currentTime * 1000 : 0);

  function settle(p: Playing, outcome: AnswerOutcome) {
    p.settle?.(outcome);
    p.settle = null;
  }

  function send(event: AnswerEvent): boolean {
    const p = current;
    if (p === null) return false;
    const next = answerTransition(p.state, event);
    if (next === null) return false;
    if (event === "audioFailed")
      log.warn("[answer] the narration's audio failed: showing it whole");
    p.state = next.to;
    if (next.clock === "start" && p.audio) p.audio.currentTime = 0;
    if (next.to === "playing") {
      if (p.audio === null) return send("audioFailed");
      p.audio.play().catch((err: unknown) => {
        // A pause right after play() (the learner barging in at once) aborts the play: not a
        // failure. Only a play that should still be playing degrades the answer.
        if (err instanceof DOMException && err.name === "AbortError") return;
        log.warn("[answer] play failed", err);
        if (current === p && p.state === "playing") send("audioFailed");
      });
    } else {
      p.audio?.pause();
    }
    if (next.to === "paused") settle(p, { kind: "paused", tMs: tMs(p) });
    if (next.to === "done") settle(p, { kind: "shown" });
    deps.onChange?.();
    return true;
  }

  /** Drops the answer playing now, if any: its first playback ends as "left". */
  function stop(): void {
    const p = current;
    if (p === null) return;
    current = null;
    p.detach();
    p.audio?.pause();
    if (p.url !== null) revokeUrl(p.url);
    settle(p, { kind: "left" });
    deps.onChange?.();
  }

  return {
    /**
     * Plays an answer's narration from the start, replacing any answer before it. Null audio
     * (it failed to load) shows the whole drawing at once. Resolves with how its first
     * playback ended.
     */
    play(audio: Blob | null): Promise<AnswerOutcome> {
      stop();
      return new Promise<AnswerOutcome>((resolve) => {
        const url = audio === null ? null : createUrl(audio);
        const element = url === null ? null : createAudio(url);
        const onEnded = () => {
          if (current === p) send("ended");
        };
        const onError = () => {
          if (current === p) send("audioFailed");
        };
        element?.addEventListener("ended", onEnded);
        element?.addEventListener("error", onError);
        const p: Playing = {
          audio: element,
          url,
          state: "paused",
          settle: resolve,
          detach: () => {
            element?.removeEventListener("ended", onEnded);
            element?.removeEventListener("error", onError);
          },
        };
        current = p;
        // From "paused" at 0, "replay" is the one event that starts it from the beginning.
        send("replay");
      });
    },
    send,
    stop,
    /** The answer's state, or null with none. */
    state: (): AnswerPlayback | null => current?.state ?? null,
    /**
     * The answer's clock for sceneAt, in ms into its narration: the audio's time, or past
     * every action once it's over (the drawing stays complete).
     */
    clockMs(): number {
      if (current === null) return 0;
      return current.state === "done" ? Infinity : tMs(current);
    },
  };
}
