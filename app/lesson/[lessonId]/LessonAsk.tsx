"use client";
// The Ask panel on the lesson page (ROADMAP Q3-Q5, ARCHITECTURE.md section 8),
// mounted through the Player's `renderAsk` and `renderBoard`:
//
// - LessonAsk: the panel, wired to the machine (ask, closeAsk,
//   agentDisconnected), the client tools of qa/tools.ts (draw_scene included)
//   and the context of qa/context.ts. What the learner asks goes to `signals`
//   (qa/askSignals.ts, issue #102); a control tool marks it a command.
// - LessonBoard: while asking, the frozen board with Ask's highlights on top,
//   or once a draw_scene answer arrives, the Answer view (./AnswerView.tsx)
//   instead of the lesson, redrawn every frame; otherwise the player's board.
//   A drawn answer is narrated (#105): ./AnswerViewAudio.ts plays it, and its
//   clock times the drawing, so it builds up on its cues as a step does.
//
// Both share one AskSession (qa/askSession.ts), created by LessonView.
import { useParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { AskClose, LessonCommand } from "@/player/controls";
import type { PlayerState } from "@/player/machine";
import type { Player } from "@/player/usePlayer";
import { Whiteboard } from "@/player/Whiteboard";
import { tellAnswerContext } from "@/qa/answerContext";
import { AskPanel } from "@/qa/AskPanel";
import { type AskSession, frozenBoard } from "@/qa/askSession";
import { narrationUpTo } from "@/qa/context";
import { type AskSignals, noteCommands } from "@/qa/askSignals";
import { createClientTools } from "@/qa/tools";
import type { AskApi } from "@/qa/types";
import type { LessonPlan } from "@/shared/lesson";
import { parseNarration } from "@/shared/validate";
import { AnswerView } from "./AnswerView";
import { type AnswerPlayer, createAnswerPlayer } from "./AnswerViewAudio";
import { answerCommand } from "./AnswerViewPlayback";
import { afterLeavingAsk, boardView, type LeaveAsk } from "./boardView";
import { useLessonVoice } from "./useLessonVoice";

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
  highlightPaper,
  signals,
}: {
  player: Player;
  session: AskSession;
  plan: LessonPlan;
  replay: boolean;
  captions: boolean;
  /** highlight_paper (issue #98): the paper beside the board. */
  highlightPaper?: (quote: string, page?: number) => string;
  /** Records the learner's questions and simplify requests (issue #102). */
  signals?: AskSignals;
}) {
  useSessionSync(player, session);
  const answerPlayer = useAnswerPlayer(session);
  // The lesson whose run folder keeps a drawn answer's audio: this page's.
  const { lessonId } = useParams<{ lessonId: string }>();
  const { send, state, loaded, step, tMs } = player;
  // The always-on mic (issue #93): the lesson's voice session and spoken commands.
  // "Hold on" while asking closes Ask only when a drawn answer is up (#97): a bare "go back".
  const isAnswerShowing = useCallback(() => answerShowing(session), [session]);
  const voice = useLessonVoice({ player, session, isAnswerShowing });
  const lessonControl = voice.control;
  // A spoken command on a drawn answer: "carry on" goes on with a held answer and "say that
  // again" replays it (./AnswerViewPlayback.ts); anything else is the lesson's, as before.
  const control = useCallback(
    (command: LessonCommand) => {
      const event = answerShowing(session)
        ? answerCommand(answerPlayer.state(), command)
        : null;
      if (event === null || !answerPlayer.send(event)) lessonControl(command);
    },
    [session, answerPlayer, lessonControl],
  );

  // What Ask was opened from, read when it closes (outside render).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  // The panel's tellAgent, once it has made the tools: the Answer view's updates use it.
  const tellRef = useRef<AskApi["tellAgent"] | null>(null);
  const tools = useCallback(
    (ask: AskApi) => {
      tellRef.current = ask.tellAgent;
      const tools = createClientTools({
        ...ask,
        board: session.board,
        highlight: session.addAction,
        lessonId,
        // An answer that arrives opens (or replaces) the Answer view, tags its answer
        // "Drawing on the board", tells the agent what's showing, and plays its narration.
        playAnswer: (answer, description) => {
          const was = answerShowing(session);
          session.showAnswer(answer.sketch, answer.cueTimes);
          ask.sketchDrawn();
          tellAnswerContext(ask.tellAgent, was, {
            kind: "drawn",
            description,
            narration: parseNarration(answer.sketch.narration).spoken,
          });
          return answerPlayer.play(answer.audio);
        },
        send,
        isAsking: session.isAsking,
        askId: session.askId,
        control,
        answerShowing: () => answerShowing(session),
        // "Go back to step N" for the step it stopped on: as the chip, not a restart.
        stoppedStep: () => {
          const now = stateRef.current;
          return now.kind === "asking" ? now.from.step : now.step;
        },
        backToLesson: () => leaveAsk(send, session, "back", stateRef.current),
        highlightPaper,
        simplifyUpcoming: signals?.simplify,
      });
      return signals ? noteCommands(tools, signals.command) : tools;
    },
    [session, send, control, highlightPaper, signals, lessonId, answerPlayer],
  );
  useBackOnLesson(session, tellRef);

  // Open and close the session with the machine, not an effect later, so a
  // tool call can never act on a closed Ask (e.g. a late go_to_step).
  const onAsk = useCallback(() => {
    if (send({ type: "ask" }).outcome === "changed") session.open();
  }, [send, session]);
  // Closing Ask (ARCHITECTURE.md section 5.6): "Got it, carry on" resumes a lesson stopped
  // mid-step; Escape or the agent ending goes back to how it was before Ask (from the
  // Answer view: paused where the learner was).
  const onClose = useCallback(
    (how: AskClose) => leaveAsk(send, session, how, stateRef.current),
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
      live={voice.live}
      onLearnerMessage={signals?.heard}
      // The learner speaking over a drawn answer holds its narration (barge-in, #105).
      onLearnerSpeech={() => answerPlayer.send("learnerSpoke")}
    />
  );
}

/**
 * The drawn answer's player (#105), one per page: the session's answer clock reads it, and Ask
 * closing (however it closes) stops it, so the narration never plays over the lesson.
 */
function useAnswerPlayer(session: AskSession): AnswerPlayer {
  const [answerPlayer] = useState(() => createAnswerPlayer());
  useEffect(() => {
    session.setAnswerClock(answerPlayer.clockMs);
    const unsubscribe = session.subscribe(() => {
      if (!session.isAsking()) answerPlayer.stop();
    });
    return () => {
      unsubscribe();
      answerPlayer.stop();
    };
  }, [session, answerPlayer]);
  return answerPlayer;
}

/** Whether the Answer view is up: Ask is open with a drawing on its layer. */
function answerShowing(session: AskSession): boolean {
  return boardView(session.isAsking(), session.layer()) === "answer";
}

/**
 * Closes Ask, as the machine's closeAsk, then what ./boardView.ts afterLeavingAsk decides
 * from how it was left and whether the Answer view was up. `before` is the player's state
 * before closing (what Ask was opened from).
 */
function leaveAsk(
  send: Player["send"],
  session: AskSession,
  how: LeaveAsk,
  before: PlayerState,
): void {
  const view = boardView(session.isAsking(), session.layer());
  session.close();
  const closed = send({ type: "closeAsk" });
  if (closed.outcome !== "changed" || before.kind !== "asking") return;
  const next = afterLeavingAsk(how, view, before.from, closed.state);
  if (next !== null) send(next);
}

/**
 * Tells the agent "Back on the lesson." when the Answer view goes away, however Ask closed.
 * The session's listeners run as it closes, before the machine's closeAsk ends the
 * conversation, so the update still reaches the agent.
 */
function useBackOnLesson(
  session: AskSession,
  tellRef: { readonly current: AskApi["tellAgent"] | null },
) {
  useEffect(() => {
    let was = answerShowing(session);
    return session.subscribe(() => {
      const now = answerShowing(session);
      if (was && !now && tellRef.current)
        tellAnswerContext(tellRef.current, was, { kind: "closed" });
      was = now;
    });
  }, [session, tellRef]);
}

/**
 * The board: the player's; while asking, the frozen board plus Ask's highlights; or, once
 * Ask has drawn an answer, the Answer view instead of the lesson.
 */
export function LessonBoard({
  player,
  session,
}: {
  player: Player;
  session: AskSession;
}) {
  useSyncExternalStore(session.subscribe, session.version, session.version);
  const { state, send } = player;
  const asking = state.kind === "asking" && session.isAsking();
  const view = boardView(asking, session.layer());
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
  if (view === "answer" && state.kind === "asking")
    return (
      <AnswerView
        board={session.board()}
        backTo={state.goTo ?? state.from.step}
        onBack={() => leaveAsk(send, session, "back", state)}
      />
    );
  return <Whiteboard state={asking ? session.board() : player.board} />;
}
