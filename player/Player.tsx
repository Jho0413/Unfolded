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
import {
  type PointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { captionFrom, prepareNarration } from "./captions";
import { adaptedMarker } from "./adapted";
import { shortcutEvent } from "./controls";
import { lessonCard } from "./cardView";
import type { Pane } from "./paper/focus";
import { AdaptedNote, TutorCard } from "./TutorCard";
import type { FetchStep } from "./stepLoader";
import { type Player as PlayerApi, usePlayer } from "./usePlayer";
import { Whiteboard } from "./Whiteboard";
import { stepView } from "./viewport";
import { WidgetPanel, WidgetPrompt } from "./widget/WidgetPanel";
import { Help } from "./help/Help";
import { widgetOnScreen } from "./widget/widgetView";
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
  /** The paper viewer, beside the board (issue #98); none: the board takes the whole stage. */
  paper?: ReactNode;
  /** Which pane is large (player/paper/focus.ts); the board by default. */
  focus?: Pane;
  /** The learner clicked a pane, or rested the mouse on it. */
  onFocusPane?: (pane: Pane) => void;
  /** At the top of the dock, over the tutor card (the lesson page's recap, issue #130). */
  dockTop?: ReactNode;
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
  paper,
  focus = "board",
  onFocusPane,
  dockTop,
}: PlayerStageProps) {
  const { state, send, loaded, tMs } = player;
  useShortcuts(send);
  const boardFocus = usePaneFocus("board", onFocusPane);
  const paperFocus = usePaneFocus("paper", onFocusPane);
  // On a phone the panes are tabs (Player.module.css): the learner's tab for this step wins,
  // otherwise the focus rules pick it.
  const [chosenTab, setChosenTab] = useState<{
    step: number;
    pane: Pane;
  } | null>(null);
  const userTab = chosenTab?.step === player.step ? chosenTab.pane : null;
  const tab = userTab ?? focus;
  // The board shows the part of the canvas the step uses (QA A4), fixed for the step.
  const step = loaded?.step;
  const view = useMemo(() => (step ? stepView(step) : undefined), [step]);
  // The audio's duration, the captions' last anchor, for the audio it was read from: a new
  // step's audio has none until its metadata loads.
  const [duration, setDuration] = useState<{ src: string; ms: number } | null>(
    null,
  );
  const src =
    typeof player.audioProps.src === "string"
      ? player.audioProps.src
      : undefined;
  const durationMs =
    duration !== null && duration.src === src ? duration.ms : null;
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
  // Stripping and splitting the narration happens once per step, not on every frame.
  const prepared = useMemo(
    () => (narration === undefined ? null : prepareNarration(narration)),
    [narration],
  );
  const caption =
    prepared === null || cueTimes === undefined
      ? null
      : captionFrom(prepared, cueTimes, durationMs, tMs);
  const title = loaded?.step.title ?? titles[player.step] ?? "";
  // A version regenerated after a learner's question says so (issue #102).
  const marker = adaptedMarker(loaded?.adaptedFrom);
  // A "try it yourself" widget at the end of the step (issue #110).
  const widget = widgetOnScreen(state, loaded?.step);
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
        <Help ask={renderAsk !== undefined} />
      </header>
      <div
        className={styles.split}
        data-testid="stage-split"
        data-paper={paper ? "1" : "0"}
        data-focus={paper ? focus : "board"}
        data-tab={paper ? tab : "board"}
      >
        {paper && (
          <div
            className={styles.tabs}
            role="tablist"
            aria-label="Board or paper"
            data-testid="pane-tabs"
          >
            {(["board", "paper"] as const).map((pane) => (
              <button
                key={pane}
                type="button"
                role="tab"
                className={styles.tab}
                aria-selected={tab === pane}
                data-testid={`tab-${pane}`}
                // A new passage while the learner keeps the board on.
                data-new={
                  pane === "paper" && tab === "board" && focus === "paper"
                    ? ""
                    : undefined
                }
                onClick={() => {
                  setChosenTab({ step: player.step, pane });
                  onFocusPane?.(pane);
                }}
              >
                {pane === "board" ? "Board" : "Paper"}
              </button>
            ))}
          </div>
        )}
        <div className={styles.board} data-testid="board-pane" {...boardFocus}>
          <div className={styles.drawing}>
            <div className={styles.fit}>
              {renderBoard ? (
                renderBoard(player)
              ) : (
                <Whiteboard state={player.board} view={view} />
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
          <div className={styles.dock} ref={trackDockHeight}>
            {dockTop}
            {widget && (
              <WidgetPanel
                key={`${player.step}:${loaded?.version ?? 0}`}
                widget={widget}
              />
            )}
            {card !== null && (
              <TutorCard
                view={card}
                caption={caption}
                onAction={send}
                holdShortcut="Space"
                notices={
                  (marker || widget) && (
                    <>
                      {marker && <AdaptedNote {...marker} />}
                      {widget && <WidgetPrompt prompt={widget.prompt} />}
                    </>
                  )
                }
              />
            )}
            {renderAsk?.(player)}
          </div>
        </div>
        {paper && (
          <div
            className={styles.paperPane}
            data-testid="paper-pane"
            {...paperFocus}
          >
            {paper}
          </div>
        )}
      </div>
      <audio
        {...player.audioProps}
        onDurationChange={(e) => {
          if (src !== undefined)
            setDuration({ src, ms: e.currentTarget.duration * 1000 });
        }}
        data-testid="player-audio"
      />
    </section>
  );
}

/**
 * Keeps `--dock-height` on the board at the dock's height, so a board that must stay clear of
 * the dock (`data-clear-of-dock`, the Answer view) sits above the card however tall it grows
 * (Player.module.css). A style property, not state: a resize doesn't re-render the stage.
 */
function trackDockHeight(dock: HTMLDivElement | null) {
  const board = dock?.parentElement;
  if (!dock || !board) return;
  const observer = new ResizeObserver(() =>
    board.style.setProperty("--dock-height", `${dock.offsetHeight}px`),
  );
  observer.observe(dock);
  return () => observer.disconnect();
}

/** How long the mouse rests on a pane before it takes focus, so passing over it doesn't. */
const HOVER_FOCUS_MS = 300;

/** A pane's pointer handlers: a press focuses it at once, a mouse resting on it after a moment. */
function usePaneFocus(pane: Pane, onFocusPane?: (pane: Pane) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    onPointerDown: () => onFocusPane?.(pane),
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || onFocusPane === undefined) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => onFocusPane(pane), HOVER_FOCUS_MS);
    },
    onPointerLeave: () => clearTimeout(timer.current),
  };
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
