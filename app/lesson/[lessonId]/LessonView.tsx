"use client";
// The lesson page's browser side (ROADMAP P6, L2, L3, ARCHITECTURE.md section 5.6): the
// outline on the left, and the stage (player/Player.tsx PlayerStage) fed by the step route
// (./stepRoute.ts), with step n + 1 prefetched once step n is on screen (player/prefetch.ts),
// whose per-step status the outline shows. A step that fails shows the route's message, and
// Retry asks again.
//
// The Ask panel (./LessonAsk.tsx) is mounted through the stage's `renderAsk` and
// `renderBoard`, sharing one AskSession; `replay` makes it say "Q&A needs a connection".
//
// The paper (issue #98, ./useLessonPaper.ts) sits beside the board when the lesson has one,
// the pane in focus the larger. Text selected in it offers "Ask about this" (issue #129): the
// passage is highlighted for a moment and Ask opens about it.
//
// Learner signals (issue #102, ./useLessonSignals.ts): Ask's questions and simplify requests
// are posted, and the prefetched next step is asked for again once Ask closes.
//
// The recap (issue #130, ./useLessonRecap.ts): once the last step ends, the ideas covered, the
// questions asked and the steps adapted, each with a replay link, over the tutor card.
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { PlayerStage } from "@/player/Player";
import { usePlayer } from "@/player/usePlayer";
import type { LessonPlan } from "@/shared/lesson";
import { ConversationProvider } from "@/qa/conversation";
import { createAskSession } from "@/qa/askSession";
import type { AskPanelHandle } from "@/qa/AskPanel";
import { createPrefetcher } from "@/player/prefetch";
import { PaperViewer } from "@/player/paper/PaperViewer";
import type { PaperSelection } from "@/player/paper/selection";
import { LessonAsk, LessonBoard } from "./LessonAsk";
import { LessonRecap } from "./LessonRecap";
import { Outline } from "./Outline";
import { stepRouteFetcher } from "./stepRoute";
import { CaptionsToggle, ThemeToggle } from "./Toggles";
import { useLessonPaper } from "./useLessonPaper";
import { useLessonRecap } from "./useLessonRecap";
import { useLessonSignals } from "./useLessonSignals";
import styles from "./lesson.module.css";

export interface LessonViewProps {
  lessonId: string;
  plan: LessonPlan;
  /** REPLAY_RUN mode (ARCHITECTURE.md section 5.5). */
  replay: boolean;
  /** `?debug=1`: the player's clock overlay. */
  debug: boolean;
}

export function LessonView({ lessonId, plan, replay, debug }: LessonViewProps) {
  // One fetcher per page load: the props never change while it's open.
  const [steps] = useState(() =>
    createPrefetcher(stepRouteFetcher(lessonId), plan.steps.length),
  );
  const [askSession] = useState(() => createAskSession());
  const [captions, setCaptions] = useState(true);
  const player = usePlayer({
    stepCount: plan.steps.length,
    fetchStep: steps.fetchStep,
    onStepReady: (n) => steps.prefetch(n + 1),
  });
  const titles = plan.steps.map((s) => s.title);
  const recap = useLessonRecap({ lessonId, player, titles });
  const signals = useLessonSignals({
    lessonId,
    player,
    steps,
    post: recap.post,
  });
  const statuses = useSyncExternalStore(
    steps.subscribe,
    steps.statuses,
    steps.statuses,
  );
  // The paper beside the board (issue #98): none until it loads, or with no paper.
  const paper = useLessonPaper(lessonId, player, askSession);
  // "Ask about this" (issue #129): highlight the passage, and open Ask about it. Stable, so
  // the memoised viewer doesn't re-render every frame.
  const askRef = useRef<AskPanelHandle>(null);
  const { askAbout } = paper;
  const onAskAbout = useCallback(
    (selection: PaperSelection) => {
      askAbout(selection);
      askRef.current?.askAbout(selection);
    },
    [askAbout],
  );
  return (
    <div
      data-testid="lesson"
      data-replay={replay ? "1" : "0"}
      className={styles.lesson}
    >
      <Outline
        plan={plan}
        coverSrc={
          plan.cover === undefined
            ? null
            : `/api/runs/${lessonId}/${plan.cover}`
        }
        current={player.step}
        state={player.state}
        statuses={statuses}
        send={player.send}
      />
      <main className={styles.main}>
        <ConversationProvider>
          <PlayerStage
            player={player}
            titles={titles}
            lessonTitle={plan.title}
            captions={captions}
            debug={debug}
            barEnd={
              <>
                <CaptionsToggle on={captions} onChange={setCaptions} />
                <ThemeToggle />
              </>
            }
            renderBoard={(p) => <LessonBoard player={p} session={askSession} />}
            paper={
              paper.pages && (
                <PaperViewer
                  pages={paper.pages}
                  highlight={paper.highlight}
                  onAskAbout={onAskAbout}
                />
              )
            }
            focus={paper.focus}
            onFocusPane={paper.onFocusPane}
            dockTop={
              recap.view && (
                <LessonRecap
                  view={recap.view}
                  state={player.state}
                  send={player.send}
                  onClose={recap.close}
                />
              )
            }
            renderAsk={(p) => (
              <LessonAsk
                player={p}
                session={askSession}
                plan={plan}
                replay={replay}
                captions={captions}
                highlightPaper={paper.highlightPaper}
                signals={signals}
                askHandle={askRef}
              />
            )}
          />
        </ConversationProvider>
      </main>
    </div>
  );
}
