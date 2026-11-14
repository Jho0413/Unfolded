"use client";
// The /dev/ask page's client side: the player machine, event buttons, and the
// Ask panel wired to ask / closeAsk / agentDisconnected, as P6 will wire it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  initialState,
  logResult,
  type PlayerEvent,
  type PlayerState,
  transition,
} from "@/player/machine";
import { AskPanel } from "@/qa/AskPanel";
import { ConversationProvider } from "@/qa/conversation";
import type { QaTools } from "@/qa/types";

const PLAN = [
  { title: "Matrices", goal: "What a matrix is" },
  {
    title: "Row times column",
    goal: "Each output cell is a row times a column",
  },
  { title: "Attention", goal: "Attention is matrix products" },
];
const NARRATION = "Take the first row and the first column, and multiply.";
const BOARD_IDS = [["a"], ["q", "k"], ["q", "k", "out"]];
const CTX = { stepCount: PLAN.length };

function currentStep(s: PlayerState): number {
  return s.kind === "asking" ? (s.goTo ?? s.from.step) : s.step;
}

export function AskDemo({ replay }: { replay: boolean }) {
  const [state, setState] = useState<PlayerState>(() => initialState().state);
  const [log, setLog] = useState<string[]>([]);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const send = useCallback((event: PlayerEvent) => {
    setState((s) => {
      const result = transition(s, event, CTX);
      logResult(result);
      return result.state;
    });
  }, []);

  const tools = useMemo<QaTools>(
    () => ({
      highlight: (p) => {
        setLog((l) => [...l, `highlight ${JSON.stringify(p)}`]);
        return "ok";
      },
      // Enough of Q4's go_to_step to test context updates on a step change.
      go_to_step: ({ step: n }) => {
        const r = transition(
          stateRef.current,
          { type: "goToStep", n: n - 1 },
          CTX,
        );
        setLog((l) => [...l, `go_to_step ${n}`]);
        if (r.outcome === "rejected") return r.message;
        stateRef.current = r.state;
        setState(r.state);
        return "ok";
      },
    }),
    [],
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
            boardIds: loading ? [] : BOARD_IDS[boardStep],
          }}
          tools={tools}
          onAsk={onAsk}
          onClose={onClose}
          onAgentDisconnected={onDropped}
        />
        <ol data-testid="tool-log">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      </main>
    </ConversationProvider>
  );
}
