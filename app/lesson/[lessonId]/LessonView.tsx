"use client";
// The lesson page's browser side (ROADMAP P6, L2, L3): the plan's title and cover, and the
// player fed by the step route (./stepRoute.ts), with step n + 1 prefetched while step n plays
// (player/prefetch.ts). A step that fails shows the route's message, and Retry asks again.
//
// The Ask panel (./LessonAsk.tsx) is mounted through the Player's `renderAsk` and
// `renderBoard`, sharing one AskSession; `replay` makes it say "Q&A needs a connection".
import { type CSSProperties, useState } from "react";
import { Player } from "@/player/Player";
import { MUTED } from "@/player/primitives/style";
import { CANVAS } from "@/shared/scene";
import type { LessonPlan } from "@/shared/lesson";
import { ConversationProvider } from "@/qa/conversation";
import { createAskSession } from "@/qa/askSession";
import { prefetchingFetcher } from "@/player/prefetch";
import { LessonAsk, LessonBoard } from "./LessonAsk";
import { stepRouteFetcher } from "./stepRoute";

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
  const [fetchStep] = useState(() =>
    prefetchingFetcher(stepRouteFetcher(lessonId), plan.steps.length),
  );
  const [askSession] = useState(() => createAskSession());
  return (
    <div data-testid="lesson" data-replay={replay ? "1" : "0"} style={LAYOUT}>
      <header style={HEADER}>
        {plan.cover !== undefined && (
          <Cover src={`/api/runs/${lessonId}/${plan.cover}`} />
        )}
        <div>
          <p style={{ margin: 0, color: MUTED }}>Lesson</p>
          <h1 style={{ margin: 0, fontSize: 28 }}>{plan.title}</h1>
        </div>
      </header>
      <ConversationProvider>
        <Player
          stepCount={plan.steps.length}
          fetchStep={fetchStep}
          debug={debug}
          renderBoard={(player) => (
            <LessonBoard player={player} session={askSession} />
          )}
          renderAsk={(player) => (
            <LessonAsk
              player={player}
              session={askSession}
              plan={plan}
              replay={replay}
            />
          )}
        />
      </ConversationProvider>
    </div>
  );
}

/** Page chrome, not a board object (ARCHITECTURE.md section 5.1). Hidden if it won't load. */
function Cover({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // A run file served by our own route: next/image's optimiser would only add a copy.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      data-testid="lesson-cover"
      onError={() => setFailed(true)}
      // The server-rendered image can fail before hydration, when React isn't listening yet.
      ref={(img) => {
        if (img?.complete && img.naturalWidth === 0) setFailed(true);
      }}
      style={COVER}
    />
  );
}

const LAYOUT: CSSProperties = {
  display: "grid",
  gap: 16,
  maxWidth: CANVAS.w,
  margin: "0 auto",
};

const HEADER: CSSProperties = {
  display: "flex",
  gap: 16,
  alignItems: "center",
};

const COVER: CSSProperties = {
  width: 96,
  height: 96,
  objectFit: "cover",
  borderRadius: 8,
};
