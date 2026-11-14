"use client";
// The lesson page's browser side (ROADMAP P6, L2, L3, ARCHITECTURE.md section 5.6): the
// outline on the left, and the stage (player/Player.tsx PlayerStage) fed by the step route
// (./stepRoute.ts), with step n + 1 prefetched once step n is on screen (player/prefetch.ts),
// whose per-step status the outline shows. A step that fails shows the route's message, and
// Retry asks again.
//
// The Ask panel (./LessonAsk.tsx) is mounted through the stage's `renderAsk` and
// `renderBoard`, sharing one AskSession; `replay` makes it say "Q&A needs a connection".
import { useState, useSyncExternalStore } from "react";
import { PlayerStage } from "@/player/Player";
import { usePlayer } from "@/player/usePlayer";
import type { LessonPlan } from "@/shared/lesson";
import { ConversationProvider } from "@/qa/conversation";
import { createAskSession } from "@/qa/askSession";
import { createPrefetcher } from "@/player/prefetch";
import { LessonAsk, LessonBoard } from "./LessonAsk";
import { Outline } from "./Outline";
import { stepRouteFetcher } from "./stepRoute";
import { CaptionsToggle, ThemeToggle } from "./Toggles";
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
  const statuses = useSyncExternalStore(
    steps.subscribe,
    steps.statuses,
    steps.statuses,
  );
  const titles = plan.steps.map((s) => s.title);
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
            renderAsk={(p) => (
              <LessonAsk
                player={p}
                session={askSession}
                plan={plan}
                replay={replay}
                captions={captions}
              />
            )}
          />
        </ConversationProvider>
      </main>
    </div>
  );
}
