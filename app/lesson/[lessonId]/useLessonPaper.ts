"use client";
// The lesson's paper (issue #98, ARCHITECTURE.md section 5.6): loads it, decides which passage
// is highlighted and which pane is large.
//
// - The narration's passage: the step's `paperRefs` at the audio time (player/paper/paperAt.ts),
//   found in the paper's text (player/paper/locate.ts). A quote that isn't found is logged and
//   changes nothing on screen.
// - The agent's passage: `highlightPaper` (the highlight_paper tool), shown while that Ask
//   lasts, over the narration's. Closing Ask throws it away, as it does the board's drawing.
// - Focus (player/paper/focus.ts): a new passage grows the paper; the board starting to animate
//   (a lesson action, or the Answer view opening during Ask) grows the board; a click or hover on a
//   pane focuses it.
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { DEFAULT_FOCUS, focusReducer, type Pane } from "@/player/paper/focus";
import { locateQuote, type PaperMatch } from "@/player/paper/locate";
import { paperRefAt } from "@/player/paper/paperAt";
import type { PaperHighlight } from "@/player/paper/PaperViewer";
import {
  type PaperPage,
  paperUrl,
  usePaperDoc,
} from "@/player/paper/usePaperDoc";
import type { Player } from "@/player/usePlayer";
import type { AskSession } from "@/qa/askSession";
import { boardView } from "./boardView";

/** What highlight_paper returns to the agent when there's no paper to show. */
export const NO_PAPER = "There is no paper to show for this lesson.";
export const PAPER_LOADING = "The paper is still loading; answer without it.";
export const QUOTE_NOT_FOUND =
  "That quote isn't in the paper; answer without it.";

export type LessonPaper = {
  /** The paper's pages once loaded; null while loading or with no paper. */
  pages: readonly PaperPage[] | null;
  highlight: PaperHighlight | null;
  focus: Pane;
  onFocusPane: (pane: Pane) => void;
  /** highlight_paper: "ok: page n", or why nothing was highlighted. */
  highlightPaper: (quote: string, page?: number) => string;
};

export function useLessonPaper(
  lessonId: string,
  player: Player,
  session: AskSession,
): LessonPaper {
  const doc = usePaperDoc(paperUrl(lessonId));
  const pages = doc.status === "ready" ? doc.pages : null;
  const items = useMemo(() => pages?.map((p) => p.items) ?? null, [pages]);

  const [focus, dispatch] = useReducer(focusReducer, DEFAULT_FOCUS);
  // A hold ends by itself: one timer for the current one.
  useEffect(() => {
    if (focus.by === "default") return;
    const id = setTimeout(
      () => dispatch({ type: "tick", atMs: performance.now() }),
      Math.max(0, focus.untilMs - performance.now()),
    );
    return () => clearTimeout(id);
  }, [focus]);

  // The narration's passage.
  const { loaded, step, tMs } = player;
  const active = loaded
    ? paperRefAt(loaded.step.paperRefs, loaded.cueTimes, tMs)
    : null;
  const cueKey =
    loaded && active ? `${step}.v${loaded.version}:${active.index}` : null;
  const quote = active?.ref.quote;
  const quotePage = active?.ref.page;
  const cueMatch = useMemo(
    () =>
      items === null || quote === undefined
        ? null
        : locateQuote(items, quote, quotePage),
    [items, quote, quotePage],
  );
  useEffect(() => {
    if (items !== null && cueKey !== null && cueMatch === null)
      console.info(`[paper] step quote not found (${cueKey}): ${quote}`);
  }, [items, cueKey, cueMatch, quote]);

  // The agent's passage, tagged with the Ask it belongs to.
  useSyncExternalStore(session.subscribe, session.version, session.version);
  const [agent, setAgent] = useState<{
    askId: number;
    n: number;
    match: PaperMatch;
  } | null>(null);
  const asking = player.state.kind === "asking" && session.isAsking();
  const agentShown =
    agent !== null && asking && agent.askId === session.askId() ? agent : null;

  // One object per passage, so the viewer only marks and scrolls when it changes.
  const highlight = useMemo<PaperHighlight | null>(
    () =>
      agentShown
        ? {
            key: `ask:${agentShown.n}`,
            match: agentShown.match,
            tone: "answer",
          }
        : cueKey !== null && cueMatch !== null
          ? { key: cueKey, match: cueMatch, tone: "lesson" }
          : null,
    [agentShown, cueKey, cueMatch],
  );

  // A new passage on screen grows the paper.
  const highlightKey = highlight?.key ?? null;
  useEffect(() => {
    if (highlightKey !== null)
      dispatch({ type: "paper", atMs: performance.now() });
  }, [highlightKey]);

  // The board starting to animate grows the board.
  const sketching = boardView(asking, session.layer()) === "answer";
  const animating =
    player.state.kind === "playing" && player.board.active.length > 0;
  const busy = sketching || animating;
  useEffect(() => {
    if (busy) dispatch({ type: "board", atMs: performance.now() });
  }, [busy]);

  const onFocusPane = useCallback(
    (pane: Pane) => dispatch({ type: "user", pane, atMs: performance.now() }),
    [],
  );

  const n = useRef(0);
  const latest = useRef({ items, status: doc.status });
  useEffect(() => {
    latest.current = { items, status: doc.status };
  });
  const highlightPaper = useCallback(
    (q: string, page?: number) => {
      const { items: text, status } = latest.current;
      if (status === "missing") return NO_PAPER;
      if (text === null) return PAPER_LOADING;
      const match = locateQuote(text, q, page);
      if (match === null) {
        console.info(`[paper] highlight_paper quote not found: ${q}`);
        return QUOTE_NOT_FOUND;
      }
      setAgent({ askId: session.askId(), n: ++n.current, match });
      return `ok: highlighted on page ${match.page}`;
    },
    [session],
  );

  return {
    pages,
    highlight,
    focus: focus.pane,
    onFocusPane,
    highlightPaper,
  };
}
