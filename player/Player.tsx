"use client";
// The lesson player (ROADMAP P5): the whiteboard, the controls and the one
// audio element, driven by usePlayer. `data-state` and `data-step` expose the
// machine for tests. `debug` adds an overlay with the clock and the last cue
// (pages turn it on with `?debug=1`).
import type { CSSProperties } from "react";
import { MUTED } from "./primitives/style";
import { Whiteboard } from "./Whiteboard";
import {
  type FetchStep,
  type Player as PlayerApi,
  usePlayer,
} from "./usePlayer";

export function Player({
  stepCount,
  fetchStep,
  debug = false,
}: {
  stepCount: number;
  fetchStep: FetchStep;
  debug?: boolean;
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
        <Whiteboard state={player.board} />
        {debug && <DebugOverlay tMs={player.tMs} lastCue={player.lastCue} />}
      </div>
      <Status player={player} />
      <Controls player={player} />
      <audio {...player.audioProps} data-testid="player-audio" />
    </section>
  );
}

function Status({ player }: { player: PlayerApi }) {
  const { state } = player;
  if (state.kind === "failed")
    return (
      <p role="alert" data-testid="player-error" style={STATUS}>
        {state.message}
      </p>
    );
  if (player.notice !== null)
    return (
      <p role="status" data-testid="player-notice" style={STATUS}>
        {player.notice}
      </p>
    );
  if (state.kind === "loading")
    return (
      <p role="status" data-testid="player-status" style={STATUS}>
        Loading step {state.step + 1}…
      </p>
    );
  if (state.kind === "finished")
    return (
      <p role="status" data-testid="player-status" style={STATUS}>
        End of the lesson.
      </p>
    );
  return null;
}

function Controls({ player }: { player: PlayerApi }) {
  const { state, can, send } = player;
  const playPause =
    state.kind === "playing"
      ? { label: "Pause", event: { type: "pause" } as const }
      : { label: "Play", event: { type: "resume" } as const };
  return (
    <div role="toolbar" aria-label="Player controls" style={TOOLBAR}>
      <button
        type="button"
        onClick={() => send({ type: "back" })}
        disabled={!can({ type: "back" })}
      >
        Back
      </button>
      <button
        type="button"
        onClick={() => send({ type: "replay" })}
        disabled={!can({ type: "replay" })}
      >
        Replay
      </button>
      <button
        type="button"
        aria-keyshortcuts="Space"
        onClick={() => send(playPause.event)}
        disabled={!can(playPause.event)}
      >
        {playPause.label}
      </button>
      <button
        type="button"
        onClick={() => send({ type: "next" })}
        disabled={!can({ type: "next" })}
      >
        Next
      </button>
      {state.kind === "failed" && (
        <button type="button" onClick={() => send({ type: "retry" })}>
          Retry
        </button>
      )}
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
  maxWidth: 1600,
  border: "1px solid #e2e8f0",
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
  color: "#f8fafc",
  font: "13px ui-monospace, monospace",
  borderRadius: 6,
  pointerEvents: "none",
};
