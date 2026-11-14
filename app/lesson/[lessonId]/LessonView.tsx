"use client";
// The lesson page's browser side (ROADMAP P6): the plan's title and cover, and the player
// fed by the saved run (./savedSteps.ts).
//
// Ask panel (ROADMAP Q3): mount it through the Player's `renderAsk`, which gets the player
// (its state and `send`). `replay` is what the panel needs to say "Q&A needs a connection",
// and `plan` and the player's `loaded` step give it its context.
import { type CSSProperties, useState } from "react";
import { Player } from "@/player/Player";
import { MUTED } from "@/player/primitives/style";
import { CANVAS } from "@/shared/scene";
import type { LessonPlan } from "@/shared/lesson";
import { savedStepFetcher } from "./savedSteps";

export interface LessonViewProps {
  lessonId: string;
  plan: LessonPlan;
  /** Per plan step, the saved version to play, or null when none is saved. */
  versions: (number | null)[];
  /** REPLAY_RUN mode (ARCHITECTURE.md section 5.5). */
  replay: boolean;
  /** `?debug=1`: the player's clock overlay. */
  debug: boolean;
}

export function LessonView({
  lessonId,
  plan,
  versions,
  replay,
  debug,
}: LessonViewProps) {
  // One fetcher per page load: the props never change while it's open.
  const [fetchStep] = useState(() => savedStepFetcher(lessonId, versions));
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
      <Player
        stepCount={plan.steps.length}
        fetchStep={fetchStep}
        debug={debug}
      />
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
