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
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSyncExternalStore } from "react";
import { timeline } from "@/player/sceneAt";
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
  const loaded = player.loaded;
  const timed = useMemo(
    () => (loaded ? timeline(loaded.step.actions, loaded.cueTimes) : []),
    [loaded],
  );
  const asking = player.state.kind === "asking";
  const { tMs } = player;
  useEffect(() => {
    session.setFrozen(
      frozenBoard(loaded ? { objects: loaded.step.objects, timed } : null, tMs),
    );
  }, [session, loaded, timed, tMs]);
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
}: {
  player: Player;
  session: AskSession;
  plan: LessonPlan;
  replay: boolean;
}) {
  useSessionSync(player, session);
  const { send, state, loaded, step, tMs } = player;

  const tools = useCallback(
    (ask: AskApi) =>
      createClientTools({
        ...ask,
        board: session.board,
        highlight: session.addAction,
        drawSketch: session.addSketch,
        send,
        isAsking: session.isAsking,
        askId: session.askId,
      }),
    [session, send],
  );

  const onAsk = useCallback(() => send({ type: "ask" }), [send]);
  const onClose = useCallback(() => send({ type: "closeAsk" }), [send]);
  const onDropped = useCallback(
    () => send({ type: "agentDisconnected" }),
    [send],
  );

  const goTo = state.kind === "asking" ? state.goTo : undefined;
  return (
    <AskPanel
      open={state.kind === "asking"}
      replay={replay}
      context={{
        planTitles: plan.steps.map((s) => s.title),
        step,
        nextStep: goTo,
        narrationSoFar: loaded
          ? narrationUpTo(loaded.step.narration, loaded.cueTimes, tMs)
          : null,
        stepGoal: plan.steps[step]?.goal,
        boardIds: player.board.objects
          .filter((s) => s.visible)
          .map((s) => s.object.id),
      }}
      tools={tools}
      onAsk={onAsk}
      onClose={onClose}
      onAgentDisconnected={onDropped}
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
  useSyncExternalStore(session.subscribe, session.layer, session.layer);
  const asking = player.state.kind === "asking" && session.isAsking();
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
  return <Whiteboard state={asking ? session.board() : player.board} />;
}
