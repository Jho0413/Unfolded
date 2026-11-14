"use client";
// The Ask panel on the lesson page (ROADMAP Q3-Q5, ARCHITECTURE.md section 8),
// mounted through the Player's `renderAsk` and `renderBoard`:
//
// - LessonAsk: the panel, wired to the machine (ask, closeAsk,
//   agentDisconnected), the client tools of qa/tools.ts (draw_scene included)
//   and the context of qa/context.ts.
// - LessonBoard: while asking, the frozen board with Ask's highlights and
//   sketches on top, redrawn every frame; otherwise the player's board.
//
// Both share one AskSession (qa/askSession.ts), created by LessonView.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { type AskClose, afterAskEvent } from "@/player/controls";
import type { Player } from "@/player/usePlayer";
import { Whiteboard } from "@/player/Whiteboard";
import { AskPanel } from "@/qa/AskPanel";
import { type AskSession, frozenBoard } from "@/qa/askSession";
import { narrationUpTo } from "@/qa/context";
import { createClientTools } from "@/qa/tools";
import type { AskApi } from "@/qa/types";
import type { LessonPlan } from "@/shared/lesson";

/** Keeps the session's frozen board and open/closed state in step with the player. */
function useSessionSync(player: Player, session: AskSession) {
  const { loaded, timed } = player;
  const asking = player.state.kind === "asking";
  const { tMs } = player;
  useEffect(() => {
    session.setFrozen(
      frozenBoard(loaded ? { objects: loaded.step.objects, timed } : null, tMs),
    );
  }, [session, loaded, timed, tMs]);
  // The callbacks below open and close the session at once; this catches
  // any other way in or out of `asking`.
  useEffect(() => {
    if (asking) session.open();
    else session.close();
  }, [session, asking]);
}

export function LessonAsk({
  player,
  session,
  plan,
  replay,
  captions,
}: {
  player: Player;
  session: AskSession;
  plan: LessonPlan;
  replay: boolean;
  captions: boolean;
}) {
  useSessionSync(player, session);
  const { send, state, loaded, step, tMs } = player;

  const tools = useCallback(
    (ask: AskApi) =>
      createClientTools({
        ...ask,
        board: session.board,
        highlight: session.addAction,
        // A sketch that reaches the board tags its answer "Drawing on the board".
        drawSketch: (sketch, fresh) => {
          session.addSketch(sketch, fresh);
          ask.sketchDrawn();
        },
        send,
        isAsking: session.isAsking,
        askId: session.askId,
      }),
    [session, send],
  );

  // Open and close the session with the machine, not an effect later, so a
  // tool call can never act on a closed Ask (e.g. a late go_to_step).
  const onAsk = useCallback(() => {
    if (send({ type: "ask" }).outcome === "changed") session.open();
  }, [send, session]);
  // What Ask was opened from, read when it closes (outside render).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  // Closing Ask (ARCHITECTURE.md section 5.6): "Got it, carry on" resumes a lesson stopped
  // mid-step; Escape or the agent ending goes back to how it was before Ask.
  const onClose = useCallback(
    (how: AskClose) => {
      const before = stateRef.current;
      session.close();
      const closed = send({ type: "closeAsk" });
      if (closed.outcome !== "changed" || before.kind !== "asking") return;
      const next = afterAskEvent(how, before.from, closed.state);
      if (next !== null) send(next);
    },
    [send, session],
  );
  const onDropped = useCallback(() => {
    session.close();
    send({ type: "agentDisconnected" });
  }, [send, session]);
  const asking = state.kind === "asking";

  const goTo = state.kind === "asking" ? state.goTo : undefined;
  return (
    <AskPanel
      open={asking}
      replay={replay}
      context={{
        planTitles: plan.steps.map((s) => s.title),
        step,
        nextStep: goTo,
        narrationSoFar: loaded
          ? narrationUpTo(loaded.step.narration, loaded.cueTimes, tMs)
          : null,
        stepGoal: plan.steps[step]?.goal,
        // While asking, the frozen board (the drawing's ids come with it).
        boardIds: (asking ? session.board() : player.board).objects
          .filter((s) => s.visible)
          .map((s) => s.object.id),
      }}
      tools={tools}
      onAsk={onAsk}
      onClose={onClose}
      onAgentDisconnected={onDropped}
      canAsk={player.can({ type: "ask" })}
      captions={captions}
    />
  );
}

/** The board: the player's, or while asking, the frozen board plus Ask's drawing. */
export function LessonBoard({
  player,
  session,
}: {
  player: Player;
  session: AskSession;
}) {
  useSyncExternalStore(session.subscribe, session.version, session.version);
  const asking = player.state.kind === "asking" && session.isAsking();
  // A sketch's own objects: drawn in the answer blue, the lesson dimmed under them.
  const sketchIds = asking
    ? new Set(session.layer().objects.map((o) => o.id))
    : undefined;
  // Redraw every frame while asking, so sketch actions play from arrival.
  const [, setFrame] = useState(0);
  useEffect(() => {
    if (!asking) return;
    let id = requestAnimationFrame(function tick() {
      setFrame((f) => f + 1);
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [asking]);
  return (
    <Whiteboard
      state={asking ? session.board() : player.board}
      sketchIds={sketchIds}
    />
  );
}
