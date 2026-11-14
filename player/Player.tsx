"use client";
// The lesson player (ROADMAP P5, ARCHITECTURE.md section 5.6): a tutor you can interrupt, not
// a video. The board is the stage, with the tutor card floating at its bottom: what the card
// says and offers comes from player/cardView.ts, every button is an existing machine event,
// and there is no transport (no play button, scrubber or timecode). `data-state` and
// `data-step` expose the machine for tests.
//
// - `Player` owns its usePlayer (the dev player). The lesson page runs usePlayer itself, to
//   share it with its outline, and renders `PlayerStage`.
// - `renderAsk` is the Ask panel's mount point under the card; while asking, the panel shows
//   its own card. `renderBoard` replaces the board (Ask draws on the frozen board, section 8).
// - Keys: Space holds on and goes on (usePlayer), → next idea, ← back, R say that again
//   (controls.ts `shortcutEvent`), A asks (the Ask panel).
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { captionAt } from "./captions";
import { shortcutEvent } from "./controls";
import { lessonCard } from "./cardView";
import { TutorCard } from "./TutorCard";
import type { FetchStep } from "./stepLoader";
import { type Player as PlayerApi, usePlayer } from "./usePlayer";
import { Whiteboard } from "./Whiteboard";
import styles from "./Player.module.css";

export function Player({
  stepCount,
  fetchStep,
  onStepReady,
  ...stage
}: {
  stepCount: number;
  fetchStep: FetchStep;
  /** The player took step n (script and audio arrived): the lesson page prefetches n + 1. */
  onStepReady?: (n: number) => void;
} & Omit<PlayerStageProps, "player">) {
  const player = usePlayer({ stepCount, fetchStep, onStepReady });
  return (
    <div className={styles.standalone}>
      <PlayerStage player={player} {...stage} />
    </div>
  );
}

export type PlayerStageProps = {
  player: PlayerApi;
  /** The plan's step titles (the card names the next idea); "Idea n" without them. */
  titles?: readonly string[];
  /** The lesson's title, for the card's intro. */
  lessonTitle?: string;
  /** Show what the tutor says as text (the Captions toggle). */
  captions?: boolean;
  /** At the end of the top bar (the lesson page's toggles). */
  barEnd?: ReactNode;
  debug?: boolean;
  /** The Ask panel, under the card (ROADMAP Q3). */
  renderAsk?: (player: PlayerApi) => ReactNode;
  /** The board; the default is `<Whiteboard state={player.board} />`. */
  renderBoard?: (player: PlayerApi) => ReactNode;
};

const NO_TITLES: readonly string[] = [];

export function PlayerStage({
  player,
  titles = NO_TITLES,
  lessonTitle,
  captions = true,
  barEnd,
  debug = false,
  renderAsk,
  renderBoard,
}: PlayerStageProps) {
  const { state, send, loaded, tMs } = player;
  useShortcuts(send);
  // The audio's duration, the captions' last anchor (NaN until its metadata loads).
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const card = lessonCard({
    state,
    notice: player.notice,
    titles,
    stepCount: player.stepCount,
    lessonTitle: lessonTitle ?? null,
    captions,
  });
  const narration = loaded?.step.narration;
  const cueTimes = loaded?.cueTimes;
  const caption = useMemo(
    () =>
      narration === undefined || cueTimes === undefined
        ? null
        : captionAt(narration, cueTimes, durationMs, tMs),
    [narration, cueTimes, durationMs, tMs],
  );
  const title = loaded?.step.title ?? titles[player.step] ?? "";
  return (
    <section
      data-testid="player"
      data-state={state.kind}
      data-step={player.step}
      aria-label="Lesson player"
      className={styles.stage}
    >
      <header className={styles.bar}>
        <div className={styles.heading}>
          <span className={styles.idea} data-testid="idea-count">
            Idea {player.step + 1} of {player.stepCount}
          </span>
          <h2 className={styles.title}>{title}</h2>
        </div>
        <span className={styles.spacer} />
        {barEnd}
      </header>
      <div className={styles.board}>
        <div className={styles.drawing}>
          <div className={styles.fit}>
            {renderBoard ? (
              renderBoard(player)
            ) : (
              <Whiteboard state={player.board} />
            )}
          </div>
        </div>
        {state.kind === "loading" && (
          <div className={styles.preparing} data-testid="board-preparing">
            <div>
              Preparing the next idea<b>{title}</b>
            </div>
          </div>
        )}
        {debug && <DebugOverlay tMs={tMs} lastCue={player.lastCue} />}
        <div className={styles.dock}>
          {card !== null && (
            <TutorCard
              view={card}
              caption={caption}
              onAction={send}
              holdShortcut="Space"
            />
          )}
          {renderAsk?.(player)}
        </div>
      </div>
      <audio
        {...player.audioProps}
        onDurationChange={(e) => setDurationMs(e.currentTarget.duration * 1000)}
        data-testid="player-audio"
      />
    </section>
  );
}

/** → next idea, ← back, R say that again (Space is usePlayer's, A the Ask panel's). */
function useShortcuts(send: PlayerApi["send"]) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const modified = e.shiftKey || e.ctrlKey || e.altKey || e.metaKey;
      const event = shortcutEvent({
        key: e.key,
        repeat: e.repeat,
        modified,
        target,
      });
      if (event === null) return;
      e.preventDefault();
      send(event);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [send]);
}

/** `?debug=1`: the audio clock and the last cue that fired. */
function DebugOverlay({
  tMs,
  lastCue,
}: {
  tMs: number;
  lastCue: string | null;
}) {
  const seconds = (tMs / 1000).toFixed(3);
  return (
    <div
      data-testid="player-debug"
      data-current-time={seconds}
      data-last-cue={lastCue ?? ""}
      className={styles.debug}
    >
      <div>currentTime {seconds} s</div>
      <div>last cue {lastCue ?? "none"}</div>
    </div>
  );
}
