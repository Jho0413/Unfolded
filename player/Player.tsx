"use client";
// The lesson player (ROADMAP P5): the whiteboard, the controls and the one
// audio element, driven by usePlayer. `data-state` and `data-step` expose the
// machine for tests. `debug` adds an overlay with the clock and the last cue
// (pages turn it on with `?debug=1`). `renderAsk` is the Ask panel's mount
// point: it gets the player (state and send), so the panel can open and close
// Ask through the machine. `renderBoard` replaces the board (the Ask panel
// draws its highlights and sketches on top of the frozen board, section 8).
import type { CSSProperties, ReactNode } from "react";
import { CANVAS } from "@/shared/scene";
import { playPauseEvent, statusFor } from "./controls";
import { FRAME_BORDER, MUTED, PAGE_BG } from "./primitives/style";
import type { FetchStep } from "./stepLoader";
import { type Player as PlayerApi, usePlayer } from "./usePlayer";
import { Whiteboard } from "./Whiteboard";

export function Player({
  stepCount,
  fetchStep,
  debug = false,
  renderAsk,
  renderBoard,
}: {
  stepCount: number;
  fetchStep: FetchStep;
  debug?: boolean;
  /** The Ask panel, rendered under the controls (ROADMAP Q3). */
  renderAsk?: (player: PlayerApi) => ReactNode;
  /** The board; the default is `<Whiteboard state={player.board} />`. */
  renderBoard?: (player: PlayerApi) => ReactNode;
}) {
  const player = usePlayer({ stepCount, fetchStep });
  const { state } = player;
  return (
    <section
      data-testid="player"
      data-state={state.kind}
      data-step={player.step}
      aria-label="Lesson player"
      style={{ display: "grid", gap: 12 }}
    >
      <header style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
        <span style={{ color: MUTED }}>
          Step {player.step + 1} of {player.stepCount}
        </span>
        <h2 style={{ margin: 0, fontSize: 20 }}>{player.loaded?.step.title}</h2>
      </header>
      <div style={BOARD_FRAME}>
        {renderBoard ? (
          renderBoard(player)
        ) : (
          <Whiteboard state={player.board} />
        )}
        {debug && <DebugOverlay tMs={player.tMs} lastCue={player.lastCue} />}
      </div>
      <Status player={player} />
      <Controls player={player} />
      {renderAsk?.(player)}
      <audio {...player.audioProps} data-testid="player-audio" />
    </section>
  );
}

const STATUS_TEST_ID = {
  error: "player-error",
  notice: "player-notice",
  info: "player-status",
} as const;

function Status({ player }: { player: PlayerApi }) {
  const status = statusFor(player.state, player.notice);
  if (status === null) return null;
  return (
    <p
      role={status.tone === "error" ? "alert" : "status"}
      data-testid={STATUS_TEST_ID[status.tone]}
      style={STATUS}
    >
      {status.text}
    </p>
  );
}

function Controls({ player }: { player: PlayerApi }) {
  const { state, can, send } = player;
  const playPause = playPauseEvent(state);
  const button = (label: string, event: Parameters<typeof send>[0]) => (
    <button
      type="button"
      onClick={() => send(event)}
      disabled={!can(event)}
      aria-keyshortcuts={event === playPause ? "Space" : undefined}
    >
      {label}
    </button>
  );
  return (
    <div role="toolbar" aria-label="Player controls" style={TOOLBAR}>
      {button("Back", { type: "back" })}
      {button("Replay", { type: "replay" })}
      {button(playPause.type === "pause" ? "Pause" : "Play", playPause)}
      {button("Next", { type: "next" })}
      {state.kind === "failed" && button("Retry", { type: "retry" })}
    </div>
  );
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
      style={DEBUG}
    >
      <div>currentTime {seconds} s</div>
      <div>last cue {lastCue ?? "none"}</div>
    </div>
  );
}

const BOARD_FRAME: CSSProperties = {
  position: "relative",
  maxWidth: CANVAS.w,
  border: `1px solid ${FRAME_BORDER}`,
  borderRadius: 8,
  overflow: "hidden",
};

const STATUS: CSSProperties = { margin: 0, minHeight: "1.5em" };

const TOOLBAR: CSSProperties = { display: "flex", gap: 8 };

const DEBUG: CSSProperties = {
  position: "absolute",
  top: 8,
  right: 8,
  padding: "6px 10px",
  background: "rgba(15, 23, 42, 0.8)",
  color: PAGE_BG,
  font: "13px ui-monospace, monospace",
  borderRadius: 6,
  pointerEvents: "none",
};
