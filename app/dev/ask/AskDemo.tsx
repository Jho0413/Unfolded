"use client";
// The /dev/ask page's client side: the player machine, event buttons, and the
// Ask panel wired to ask / closeAsk / agentDisconnected and the client tools
// (qa/tools.ts), as P6 will wire them. The board is a list of objects here;
// highlights are listed, and thrown away when Ask closes (section 8).
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  initialState,
  logResult,
  type PlayerEvent,
  type PlayerState,
  transition,
} from "@/player/machine";
import type { BoardObject, BoardState } from "@/shared/scene";
import { AskPanel } from "@/qa/AskPanel";
import { ConversationProvider } from "@/qa/conversation";
import { createClientTools, type HighlightAction } from "@/qa/tools";

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
const EMPTY_BOARD: BoardState = { objects: [], copies: [], active: [] };
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

/** The player machine as a tiny store: send() answers synchronously. */
function createMachine() {
  let state: PlayerState = initialState().state;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    send: (event: PlayerEvent) => {
      const result = transition(state, event, CTX);
      logResult(result);
      state = result.state;
      for (const fn of listeners) fn();
      return result;
    },
  };
}

function currentStep(s: PlayerState): number {
  return s.kind === "asking" ? (s.goTo ?? s.from.step) : s.step;
}

export function AskDemo({ replay }: { replay: boolean }) {
  const [machine] = useState(createMachine);
  const state = useSyncExternalStore(
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

  const board = useCallback((): BoardState => {
    const s = machine.get();
    const from = s.kind === "asking" ? s.from : s;
    return from.kind === "loading" ? EMPTY_BOARD : boardOf(BOARDS[from.step]);
  }, [machine]);
  const highlight = useCallback(
    (a: HighlightAction) => setHighlights((h) => [...h, a]),
    [],
  );

  const tools = useMemo(() => {
    const t = createClientTools({ board, highlight, send });
    // Log each call and its result for the e2e tests.
    return Object.fromEntries(
      Object.entries(t).map(([name, handler]) => [
        name,
        async (p: never) => {
          const result = await (handler as (p: never) => unknown)(p);
          setLog((l) => [
            ...l,
            `${name} ${JSON.stringify(p)} -> ${String(result)}`,
          ]);
          return result;
        },
      ]),
    ) as typeof t;
  }, [board, highlight, send]);

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
        <ul data-testid="highlights">
          {highlights.map((a, i) => (
            <li
              key={i}
              data-target={[a.target.id, a.target.row, a.target.col].join(",")}
            >
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
