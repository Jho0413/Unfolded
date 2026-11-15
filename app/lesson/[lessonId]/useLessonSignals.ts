"use client";
// The lesson's learner signals (issue #102, ARCHITECTURE.md section 5.4), apart from LessonAsk:
//
// - `signals` (qa/askSignals.ts) records the questions and simplify requests Ask hears, with the
//   step on screen and the time into it, and posts them (./signalsRoute.ts).
// - When Ask closes, what it heard is posted; if any of it was recorded, the prefetched step
//   after the one on screen is out of date, so it is asked for again (player/prefetch.ts
//   refresh). Next still never waits: it plays the new version if it has arrived.
//   A simplify request made with Ask closed does the same at once.
// - When a step version starts playing, "started" is posted once, so the server keeps it.
import { useEffect, useRef, useState } from "react";
import type { Prefetcher } from "@/player/prefetch";
import type { Player } from "@/player/usePlayer";
import { type AskSignals, createAskSignals } from "@/qa/askSignals";
import { type PostSignal, signalsRoutePoster } from "./signalsRoute";

export function useLessonSignals({
  lessonId,
  player,
  steps,
  post: givenPost,
}: {
  lessonId: string;
  player: Player;
  steps: Pick<Prefetcher, "refresh">;
  /** The signal post; the route by default. */
  post?: PostSignal;
}): AskSignals {
  const { step, tMs, state, loaded } = player;
  const asking = state.kind === "asking";
  const [api] = useState(() => {
    // Where the learner is, read by the recorder and the refresh outside render.
    const now = { current: { step: 0, tMs: 0, asking: false } };
    const setNow = (next: typeof now.current) => {
      now.current = next;
    };
    const post = givenPost ?? signalsRoutePoster(lessonId);
    const recorder = createAskSignals({
      post,
      where: () => ({ step: now.current.step, t: now.current.tMs }),
    });
    /** Posts what's held; once recorded, the step after the one on screen is asked again. */
    const flush = () =>
      void recorder.flush().then((recorded) => {
        if (recorded) steps.refresh(now.current.step + 1);
      });
    const signals: AskSignals = {
      ...recorder,
      simplify: (reason) => {
        recorder.simplify(reason);
        if (!now.current.asking) flush();
      },
    };
    return { post, signals, flush, setNow };
  });
  useEffect(() => {
    api.setNow({ step, tMs, asking });
  });

  // Ask closed (however it closed): what it heard goes to the server.
  const wasAsking = useRef(asking);
  useEffect(() => {
    if (wasAsking.current && !asking) api.flush();
    wasAsking.current = asking;
  }, [asking, api]);

  // A step version starts playing: "started", once per version.
  const started = useRef(new Set<string>());
  const version = loaded?.version;
  const playing = state.kind === "playing";
  useEffect(() => {
    if (!playing || version === undefined) return;
    const key = `${step}:${version}`;
    if (started.current.has(key)) return;
    started.current.add(key);
    void api.post({ started: step, version });
  }, [playing, step, version, api]);

  return api.signals;
}
