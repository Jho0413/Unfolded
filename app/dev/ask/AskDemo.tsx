"use client";
// The /dev/ask page's client side: the player machine, event buttons, and the
// Ask panel wired to ask / closeAsk / agentDisconnected and the client tools
// (qa/tools.ts), as P6 will wire them. The board is a list of objects here;
// highlights are listed, and thrown away when Ask closes (section 8).
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  initialState,
  logResult,
  type PlayerEvent,
  type PlayerState,
  transition,
} from "@/player/machine";
import type { CueTimes } from "@/shared/lesson";
import type { Action, BoardObject, BoardState, Sketch } from "@/shared/scene";
import { ConversationProvider } from "@/qa/conversation";
import { AskPanel, type AskApi } from "@/qa/AskPanel";
import {
  addAction,
  answerLayer,
  type AskLayer,
  askScene,
  EMPTY_LAYER,
} from "@/qa/askBoard";
import { createClientTools, type HighlightAction } from "@/qa/tools";
import { Whiteboard } from "@/player/Whiteboard";

const PLAN = [
  { title: "Matrices", goal: "What a matrix is" },
  {
    title: "Row times column",
    goal: "Each output cell is a row times a column",
  },
  { title: "Attention", goal: "Attention is matrix products" },
];
const NARRATION = "Take the first row and the first column, and multiply.";
const matrix = (id: string, x: number): BoardObject => ({
  kind: "matrix",
  id,
  x,
  y: 200,
  rows: [
    ["1", "2"],
    ["3", "4"],
  ],
});
const BOARDS: BoardObject[][] = [
  [matrix("q", 100), { kind: "text", id: "a", x: 100, y: 100, text: "A" }],
  [matrix("q", 100), matrix("k", 400)],
  [matrix("q", 100), matrix("k", 400), matrix("out", 700)],
];
function boardOf(objects: BoardObject[]): BoardState {
  return {
    objects: objects.map((object) => ({
      object,
      visible: true,
      highlight: null,
    })),
    copies: [],
    active: [],
  };
}
const CTX = { stepCount: PLAN.length };
/** The run folder a drawn answer's audio is saved in: this page has no lesson of its own. */
const DEV_ASK_LESSON = "dev-ask";

/**
 * The player machine and the Ask layer as a tiny store: send() answers
 * synchronously, so go_to_step can return the machine's answer to the agent.
 */
function createMachine() {
  let snap: { state: PlayerState; layer: AskLayer } = {
    state: initialState().state,
    layer: EMPTY_LAYER,
  };
  let openedAt = 0;
  let askId = 0;
  const listeners = new Set<() => void>();
  const set = (next: Partial<typeof snap>) => {
    snap = { ...snap, ...next };
    for (const fn of listeners) fn();
  };
  const sinceOpen = () => performance.now() - openedAt;
  return {
    get: () => snap,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    send: (event: PlayerEvent) => {
      const was = snap.state.kind;
      const result = transition(snap.state, event, CTX);
      logResult(result);
      const restore =
        result.outcome === "changed" &&
        result.effects.some((e) => e.type === "restoreBoard");
      const opened = was !== "asking" && result.state.kind === "asking";
      if (opened) {
        openedAt = performance.now();
        askId++;
      }
      set({
        state: result.state,
        layer: restore || opened ? EMPTY_LAYER : snap.layer,
      });
      return result;
    },
    sinceOpen,
    askId: () => askId,
    addAction: (a: Action) =>
      set({ layer: addAction(snap.layer, a, sinceOpen()) }),
    showAnswer: (sketch: Sketch, cueTimes: CueTimes) =>
      set({ layer: answerLayer(sketch, cueTimes) }),
    /** The board on screen: the frozen lesson board plus the Ask layer. */
    board: (): BoardState => {
      const { state, layer } = snap;
      const from = state.kind === "asking" ? state.from : state;
      const objects = from.kind === "loading" ? [] : BOARDS[from.step];
      if (state.kind !== "asking") return boardOf(objects);
      // A drawn answer shows whole: this page doesn't play its narration.
      return askScene(
        { objects, timed: [], pausedT: 0 },
        layer,
        sinceOpen(),
        Infinity,
      );
    },
  };
}

function currentStep(s: PlayerState): number {
  return s.kind === "asking" ? (s.goTo ?? s.from.step) : s.step;
}

/** The board, redrawn every frame while asking so highlights play from arrival. */
function AskBoardView({
  machine,
  asking,
}: {
  machine: ReturnType<typeof createMachine>;
  asking: boolean;
}) {
  useSyncExternalStore(machine.subscribe, machine.get, machine.get);
  const [, setFrame] = useState(0);
  useEffect(() => {
    if (!asking) return;
    let id = requestAnimationFrame(function tick() {
      setFrame((f) => f + 1);
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [asking]);
  return <Whiteboard state={machine.board()} />;
}

export function AskDemo({ replay }: { replay: boolean }) {
  const [machine] = useState(createMachine);
  const { state } = useSyncExternalStore(
    machine.subscribe,
    machine.get,
    machine.get,
  );

  const [log, setLog] = useState<string[]>([]);
  const [highlights, setHighlights] = useState<HighlightAction[]>([]);

  // Synchronous, so go_to_step can return the machine's answer to the agent.
  const send = useCallback(
    (event: PlayerEvent) => {
      const result = machine.send(event);
      if (
        result.outcome === "changed" &&
        result.effects.some((e) => e.type === "restoreBoard")
      )
        setHighlights([]);
      return result;
    },
    [machine],
  );

  const tools = useCallback(
    (ask: AskApi) => {
      const t = createClientTools({
        board: machine.board,
        highlight: (a: HighlightAction) => {
          machine.addAction(a);
          setHighlights((h) => [...h, a]);
        },
        // Every drawn answer is fresh (qa/drawScene.ts); it shows whole, with no narration.
        lessonId: DEV_ASK_LESSON,
        playAnswer: (answer) => {
          machine.showAnswer(answer.sketch, answer.cueTimes);
          return Promise.resolve({ kind: "shown" } as const);
        },
        ...ask,
        send,
        isAsking: () => machine.get().state.kind === "asking",
        askId: machine.askId,
      });
      // Log each call and its result for the e2e tests.
      return Object.fromEntries(
        Object.entries(t).map(([name, handler]) => [
          name,
          async (p: never) => {
            const result = await (handler as (p: never) => unknown)(p);
            setLog((l) => [
              ...l,
              `${name} ${JSON.stringify(p)} -> ${String(result ?? "(no result)")}`,
            ]);
            return result;
          },
        ]),
      ) as typeof t;
    },
    [send, machine],
  );

  const step = currentStep(state);
  // The board stays on the step Ask opened from until Ask closes (section 8);
  // a go_to_step jump is sent as the next step.
  const boardStep = state.kind === "asking" ? state.from.step : step;
  const nextStep = state.kind === "asking" ? state.goTo : undefined;
  const loading =
    state.kind === "loading" ||
    (state.kind === "asking" && state.from.kind === "loading");
  const onAsk = useCallback(() => send({ type: "ask" }), [send]);
  const onClose = useCallback(() => send({ type: "closeAsk" }), [send]);
  const onDropped = useCallback(
    () => send({ type: "agentDisconnected" }),
    [send],
  );

  const events: [string, PlayerEvent][] = [
    ["stepReady", { type: "stepReady", i: step }],
    ["pause", { type: "pause" }],
    ["resume", { type: "resume" }],
    ["audioEnded", { type: "audioEnded" }],
    ["next", { type: "next" }],
    ["back", { type: "back" }],
  ];

  return (
    <ConversationProvider>
      <main
        data-testid="dev-ask"
        data-state={state.kind}
        data-step={step}
        style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}
      >
        <p role="note">
          Dev only: Ask panel test page, not part of the product.
        </p>
        <p>
          State: <strong>{state.kind}</strong>, step {step + 1} of {PLAN.length}
        </p>
        <nav aria-label="Player events" style={{ display: "flex", gap: 8 }}>
          {events.map(([label, e]) => (
            <button key={label} type="button" onClick={() => send(e)}>
              {label}
            </button>
          ))}
        </nav>
        <AskPanel
          open={state.kind === "asking"}
          replay={replay}
          context={{
            planTitles: PLAN.map((p) => p.title),
            step: boardStep,
            nextStep,
            narrationSoFar: loading ? null : NARRATION,
            stepGoal: PLAN[boardStep].goal,
            boardIds: loading ? [] : BOARDS[boardStep].map((o) => o.id),
          }}
          tools={tools}
          onAsk={onAsk}
          onClose={onClose}
          onAgentDisconnected={onDropped}
        />
        <div style={{ maxWidth: 960, border: "1px solid #e2e8f0" }}>
          <AskBoardView machine={machine} asking={state.kind === "asking"} />
        </div>
        <ul data-testid="highlights">
          {highlights.map((a, i) => (
            <li key={i} data-target={JSON.stringify(a.target)}>
              highlight {JSON.stringify(a.target)}
            </li>
          ))}
        </ul>
        <ol data-testid="tool-log">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      </main>
    </ConversationProvider>
  );
}
