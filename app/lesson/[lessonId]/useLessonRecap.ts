"use client";
// What the end-of-lesson recap (issue #130, ./recap.ts) needs, gathered in the browser:
//
// - the steps that started playing, and for each the adaptedFrom of the version it last played
//   (a regenerated version, #102);
// - the questions posted as signals (`post` wraps the signals route, so a message the agent
//   took as a lesson command never shows: it is never posted).
//
// The recap shows once the last step ends; Close hides it until the lesson's end is reached
// again (after a replay, say).
import { useCallback, useState } from "react";
import type { Player } from "@/player/usePlayer";
import type { AdaptedFrom, Signal } from "@/shared/lesson";
import {
  atLessonEnd,
  type RecapQuestion,
  type RecapView,
  recapQuestion,
  recapView,
} from "./recap";
import { type PostSignal, signalsRoutePoster } from "./signalsRoute";

export type LessonRecap = {
  /** The signals post for useLessonSignals: the route, noting each question. */
  post: PostSignal;
  /** The recap to show now, or null (not at the end, or closed). */
  view: RecapView | null;
  close: () => void;
};

export function useLessonRecap({
  lessonId,
  player,
  titles,
}: {
  lessonId: string;
  player: Player;
  titles: readonly string[];
}): LessonRecap {
  const [questions, setQuestions] = useState<RecapQuestion[]>([]);
  const [played, setPlayed] = useState<ReadonlySet<number>>(() => new Set());
  const [adapted, setAdapted] = useState<ReadonlyMap<number, AdaptedFrom>>(
    () => new Map(),
  );
  const [post] = useState(() => {
    const route = signalsRoutePoster(lessonId);
    return (signal: Signal) => {
      const q = recapQuestion(signal);
      if (q !== null) setQuestions((qs) => [...qs, q]);
      return route(signal);
    };
  });

  const { state, step, loaded } = player;
  const playing = state.kind === "playing";
  const from = loaded?.adaptedFrom;
  // A step playing is noted as it renders (React's "adjust state while rendering"): each
  // update makes the condition false, so it settles in one extra render.
  if (playing && !played.has(step)) setPlayed(new Set(played).add(step));
  if (playing && adapted.get(step) !== from) {
    const next = new Map(adapted);
    if (from) next.set(step, from);
    else next.delete(step);
    setAdapted(next);
  }

  // Closed for this visit to the end: leaving the end opens it for the next one.
  const atEnd = atLessonEnd(state, player.stepCount);
  const [closed, setClosed] = useState(false);
  if (closed && !atEnd) setClosed(false);
  const close = useCallback(() => setClosed(true), []);

  return {
    post,
    view:
      atEnd && !closed
        ? recapView({ titles, played, questions, adapted })
        : null,
    close,
  };
}
