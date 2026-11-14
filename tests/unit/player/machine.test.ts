// One test per cell of the ARCHITECTURE.md section 6.1 state x event table,
// named after the cell, plus the bullet rules under the table and a few
// scenarios the ROADMAP P4 row names (Ask while loading, goToStep during Ask).
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  initialState,
  logResult,
  MESSAGES,
  transition,
  type AskOrigin,
  type PlayerEffect,
  type PlayerEvent,
  type PlayerState,
  type TransitionResult,
} from "@/player/machine";

const ctx = { stepCount: 3 }; // steps 0, 1, 2; step 2 is the last
const SERVER_MSG = "Couldn't make this step. Retry?";

// ---------------------------------------------------------------- fixtures

const loading = (step = 1, autoplay = true): PlayerState => ({
  kind: "loading",
  step,
  autoplay,
});
const playing = (step = 1): PlayerState => ({ kind: "playing", step });
const paused = (step = 1): PlayerState => ({ kind: "paused", step });
const stepEnded = (step = 1): PlayerState => ({ kind: "stepEnded", step });
const finished = (step = 2): PlayerState => ({ kind: "finished", step });
const failed = (step = 1, message = SERVER_MSG): PlayerState => ({
  kind: "failed",
  step,
  message,
});
const asking = (from: AskOrigin, goTo?: number): PlayerState =>
  goTo === undefined
    ? { kind: "asking", from }
    : { kind: "asking", from, goTo };

/** Ask opened from each kind of state, to run asking cells over all of them. */
const askOrigins: AskOrigin[] = [
  { kind: "loading", step: 1, autoplay: true },
  { kind: "loading", step: 1, autoplay: true, arrived: { ok: true } },
  { kind: "playing", step: 1 },
  { kind: "paused", step: 1 },
  { kind: "stepEnded", step: 1 },
  { kind: "finished", step: 2 },
];

const ev = {
  ready: (i: number): PlayerEvent => ({ type: "stepReady", i }),
  failed: (i: number, message = SERVER_MSG): PlayerEvent => ({
    type: "stepFailed",
    i,
    message,
  }),
  go: (n: number): PlayerEvent => ({ type: "goToStep", n }),
  of: (
    type: Exclude<PlayerEvent["type"], "stepReady" | "stepFailed" | "goToStep">,
  ) => ({ type }) as PlayerEvent,
};

const load = (step: number): PlayerEffect => ({ type: "loadStep", step });
const seek: PlayerEffect = { type: "seekToStart" };
const restore: PlayerEffect = { type: "restoreBoard" };
const notice = (message: string): PlayerEffect => ({ type: "notice", message });

// ---------------------------------------------------------------- expectations

type Expected =
  | { outcome: "changed"; state: PlayerState; effects?: PlayerEffect[] }
  | { outcome: "ignored"; late?: boolean }
  | { outcome: "rejected"; message: string }
  | { outcome: "cantHappen" };

const to = (state: PlayerState, ...effects: PlayerEffect[]): Expected => ({
  outcome: "changed",
  state,
  effects,
});
const IGNORED: Expected = { outcome: "ignored" };
const LATE: Expected = { outcome: "ignored", late: true };
const CANT: Expected = { outcome: "cantHappen" };
const rejected = (message: string): Expected => ({
  outcome: "rejected",
  message,
});

function check(state: PlayerState, event: PlayerEvent, want: Expected) {
  const before = structuredClone(state);
  const got: TransitionResult = transition(state, event, ctx);
  expect(state, "transition must not mutate its input").toEqual(before);
  expect(got.outcome).toBe(want.outcome);
  switch (want.outcome) {
    case "changed":
      expect(got.state).toEqual(want.state);
      if (got.outcome === "changed")
        expect(got.effects).toEqual(want.effects ?? []);
      return;
    case "ignored":
      expect(got.state).toBe(state);
      if (got.outcome === "ignored") {
        if (want.late) expect(got.log).toMatch(/late reply/);
        else expect(got.log).toBeUndefined();
      }
      return;
    case "rejected":
      expect(got.state).toBe(state);
      if (got.outcome === "rejected") expect(got.message).toBe(want.message);
      return;
    case "cantHappen":
      expect(got.state).toBe(state);
      if (got.outcome === "cantHappen") expect(got.warning).toBeTruthy();
      return;
  }
}

// ---------------------------------------------------------------- the table

const STATES = [
  "loading",
  "playing",
  "paused",
  "stepEnded",
  "asking",
  "failed",
  "finished",
] as const;
const COLUMNS = [
  "stepReady(i) / stepFailed(i)",
  "audioEnded",
  "playBlocked",
  "audioError",
  "pause",
  "resume",
  "replay",
  "ask",
  "closeAsk",
  "agentDisconnected",
  "next",
  "back",
  "goToStep(n)",
  "retry",
] as const;
type Column = (typeof COLUMNS)[number];
type Case = [PlayerState, PlayerEvent, Expected];

/** Every asking origin, each with the same event and expectation. */
const forAllOrigins = (event: PlayerEvent, want: Expected): Case[] =>
  askOrigins.map((o) => [asking(o), event, want]);

/** A no-payload event in a state, with a single expectation. */
const one =
  (state: PlayerState) =>
  (type: Parameters<typeof ev.of>[0], want: Expected): Case[] => [
    [state, ev.of(type), want],
  ];

const L = one(loading());
const P = one(playing());
const Pa = one(paused());
const E = one(stepEnded());
const F = one(failed());
const Fi = one(finished());
const A = (type: Parameters<typeof ev.of>[0], want: Expected) =>
  forAllOrigins(ev.of(type), want);

const TABLE: Record<(typeof STATES)[number], Record<Column, Case[]>> = {
  loading: {
    "stepReady(i) / stepFailed(i)": [
      [loading(1, true), ev.ready(1), to(playing(1))],
      [loading(1, false), ev.ready(1), to(paused(1))],
      [loading(1, true), ev.failed(1), to(failed(1, SERVER_MSG))],
      [
        loading(1, true),
        ev.failed(1, "This step isn't in the saved run."),
        to(failed(1, "This step isn't in the saved run.")),
      ],
      [loading(1), ev.ready(0), LATE],
      [loading(1), ev.failed(2), LATE],
    ],
    audioEnded: L("audioEnded", CANT),
    playBlocked: L("playBlocked", CANT),
    audioError: L("audioError", CANT),
    pause: L("pause", IGNORED),
    resume: L("resume", IGNORED),
    replay: L("replay", IGNORED),
    ask: [
      [
        loading(1, true),
        ev.of("ask"),
        to(asking({ kind: "loading", step: 1, autoplay: true })),
      ],
      [
        loading(1, false),
        ev.of("ask"),
        to(asking({ kind: "loading", step: 1, autoplay: false })),
      ],
    ],
    closeAsk: L("closeAsk", CANT),
    agentDisconnected: L("agentDisconnected", CANT),
    next: L("next", IGNORED),
    back: L("back", IGNORED),
    "goToStep(n)": [
      [loading(1), ev.go(2), to(loading(2, true), load(2))],
      [loading(1, false), ev.go(0), to(loading(0, true), load(0))],
    ],
    retry: L("retry", IGNORED),
  },

  playing: {
    "stepReady(i) / stepFailed(i)": [
      [playing(1), ev.ready(0), LATE],
      [playing(1), ev.failed(1), LATE],
    ],
    audioEnded: P("audioEnded", to(stepEnded(1))),
    playBlocked: P("playBlocked", to(paused(1), notice(MESSAGES.pressPlay))),
    audioError: P("audioError", to(failed(1, MESSAGES.audioFailed))),
    pause: P("pause", to(paused(1))),
    resume: P("resume", IGNORED),
    replay: P("replay", to(playing(1), seek)),
    ask: P("ask", to(asking({ kind: "playing", step: 1 }))),
    closeAsk: P("closeAsk", CANT),
    agentDisconnected: P("agentDisconnected", CANT),
    next: P("next", IGNORED),
    back: [
      [playing(1), ev.of("back"), to(loading(0, true), load(0))],
      [playing(0), ev.of("back"), to(playing(0), seek)],
    ],
    "goToStep(n)": [[playing(1), ev.go(2), to(loading(2, true), load(2))]],
    retry: P("retry", IGNORED),
  },

  paused: {
    "stepReady(i) / stepFailed(i)": [
      [paused(1), ev.ready(2), LATE],
      [paused(1), ev.failed(0), LATE],
    ],
    audioEnded: Pa("audioEnded", CANT),
    playBlocked: Pa("playBlocked", CANT),
    audioError: Pa("audioError", IGNORED),
    pause: Pa("pause", IGNORED),
    resume: Pa("resume", to(playing(1))),
    replay: Pa("replay", to(playing(1), seek)),
    ask: Pa("ask", to(asking({ kind: "paused", step: 1 }))),
    closeAsk: Pa("closeAsk", CANT),
    agentDisconnected: Pa("agentDisconnected", CANT),
    next: Pa("next", IGNORED),
    back: [
      [paused(1), ev.of("back"), to(loading(0, true), load(0))],
      [paused(0), ev.of("back"), to(playing(0), seek)],
    ],
    "goToStep(n)": [[paused(1), ev.go(0), to(loading(0, true), load(0))]],
    retry: Pa("retry", IGNORED),
  },

  stepEnded: {
    "stepReady(i) / stepFailed(i)": [
      [stepEnded(1), ev.ready(1), LATE],
      [stepEnded(1), ev.failed(2), LATE],
    ],
    audioEnded: E("audioEnded", CANT),
    playBlocked: E("playBlocked", CANT),
    audioError: E("audioError", IGNORED),
    pause: E("pause", IGNORED),
    resume: E("resume", IGNORED),
    replay: E("replay", to(playing(1), seek)),
    ask: E("ask", to(asking({ kind: "stepEnded", step: 1 }))),
    closeAsk: E("closeAsk", CANT),
    agentDisconnected: E("agentDisconnected", CANT),
    next: [
      [stepEnded(1), ev.of("next"), to(loading(2, true), load(2))],
      [stepEnded(2), ev.of("next"), to(finished(2))],
    ],
    back: [
      [stepEnded(1), ev.of("back"), to(loading(0, true), load(0))],
      [stepEnded(0), ev.of("back"), to(playing(0), seek)],
    ],
    "goToStep(n)": [[stepEnded(1), ev.go(1), to(loading(1, true), load(1))]],
    retry: E("retry", IGNORED),
  },

  asking: {
    "stepReady(i) / stepFailed(i)": [
      // Opened from loading(1) and i = 1: remembered for closeAsk.
      [
        asking({ kind: "loading", step: 1, autoplay: true }),
        ev.ready(1),
        to(
          asking({
            kind: "loading",
            step: 1,
            autoplay: true,
            arrived: { ok: true },
          }),
        ),
      ],
      [
        asking({ kind: "loading", step: 1, autoplay: false }, 2),
        ev.failed(1),
        to(
          asking(
            {
              kind: "loading",
              step: 1,
              autoplay: false,
              arrived: { ok: false, message: SERVER_MSG },
            },
            2,
          ),
        ),
      ],
      // Otherwise a late reply.
      [asking({ kind: "loading", step: 1, autoplay: true }), ev.ready(0), LATE],
      [asking({ kind: "playing", step: 1 }), ev.ready(1), LATE],
      [asking({ kind: "finished", step: 2 }), ev.failed(2), LATE],
    ],
    audioEnded: A("audioEnded", CANT),
    playBlocked: A("playBlocked", CANT),
    audioError: A("audioError", IGNORED),
    pause: A("pause", IGNORED),
    resume: A("resume", IGNORED),
    replay: A("replay", IGNORED),
    ask: A("ask", IGNORED),
    closeAsk: [
      [
        asking({ kind: "playing", step: 1 }),
        ev.of("closeAsk"),
        to(paused(1), restore),
      ],
      [
        asking({ kind: "paused", step: 1 }),
        ev.of("closeAsk"),
        to(paused(1), restore),
      ],
      [
        asking({ kind: "stepEnded", step: 1 }),
        ev.of("closeAsk"),
        to(stepEnded(1), restore),
      ],
      [
        asking({ kind: "finished", step: 2 }),
        ev.of("closeAsk"),
        to(finished(2), restore),
      ],
      // From loading(k): the step arrived -> paused; it failed -> failed; not yet -> loading(k).
      [
        asking({
          kind: "loading",
          step: 1,
          autoplay: true,
          arrived: { ok: true },
        }),
        ev.of("closeAsk"),
        to(paused(1), restore),
      ],
      [
        asking({
          kind: "loading",
          step: 1,
          autoplay: true,
          arrived: { ok: false, message: SERVER_MSG },
        }),
        ev.of("closeAsk"),
        to(failed(1, SERVER_MSG), restore),
      ],
      [
        asking({ kind: "loading", step: 1, autoplay: true }),
        ev.of("closeAsk"),
        to(loading(1, true), restore),
      ],
      // The agent called goToStep(n): -> loading(n, no autoplay), from any origin.
      ...askOrigins.map((o): Case => [
        asking(o, 0),
        ev.of("closeAsk"),
        to(loading(0, false), restore, load(0)),
      ]),
    ],
    agentDisconnected: [
      [
        asking({ kind: "playing", step: 1 }),
        ev.of("agentDisconnected"),
        to(paused(1), restore, notice(MESSAGES.qaEnded)),
      ],
      [
        asking({ kind: "paused", step: 1 }),
        ev.of("agentDisconnected"),
        to(paused(1), restore, notice(MESSAGES.qaEnded)),
      ],
      [
        asking({ kind: "stepEnded", step: 1 }),
        ev.of("agentDisconnected"),
        to(stepEnded(1), restore, notice(MESSAGES.qaEnded)),
      ],
      [
        asking({ kind: "finished", step: 2 }),
        ev.of("agentDisconnected"),
        to(finished(2), restore, notice(MESSAGES.qaEnded)),
      ],
      [
        asking({
          kind: "loading",
          step: 1,
          autoplay: false,
          arrived: { ok: true },
        }),
        ev.of("agentDisconnected"),
        to(paused(1), restore, notice(MESSAGES.qaEnded)),
      ],
      [
        asking({
          kind: "loading",
          step: 1,
          autoplay: true,
          arrived: { ok: false, message: SERVER_MSG },
        }),
        ev.of("agentDisconnected"),
        to(failed(1, SERVER_MSG), restore, notice(MESSAGES.qaEnded)),
      ],
      [
        asking({ kind: "loading", step: 1, autoplay: true }),
        ev.of("agentDisconnected"),
        to(loading(1, true), restore, notice(MESSAGES.qaEnded)),
      ],
      [
        asking({ kind: "playing", step: 1 }, 2),
        ev.of("agentDisconnected"),
        to(loading(2, false), restore, notice(MESSAGES.qaEnded), load(2)),
      ],
    ],
    next: A("next", IGNORED),
    back: A("back", IGNORED),
    "goToStep(n)": [
      ...askOrigins.map((o): Case => [asking(o), ev.go(2), to(asking(o, 2))]),
      // A second jump replaces the first.
      [
        asking({ kind: "playing", step: 1 }, 2),
        ev.go(0),
        to(asking({ kind: "playing", step: 1 }, 0)),
      ],
    ],
    retry: A("retry", IGNORED),
  },

  failed: {
    "stepReady(i) / stepFailed(i)": [
      [failed(1), ev.ready(1), LATE],
      [failed(1), ev.failed(0), LATE],
    ],
    audioEnded: F("audioEnded", CANT),
    playBlocked: F("playBlocked", CANT),
    audioError: F("audioError", CANT),
    pause: F("pause", IGNORED),
    resume: F("resume", IGNORED),
    replay: F("replay", IGNORED),
    ask: F("ask", rejected(MESSAGES.nothingToAsk)),
    closeAsk: F("closeAsk", CANT),
    agentDisconnected: F("agentDisconnected", CANT),
    next: F("next", IGNORED),
    back: [
      [failed(1), ev.of("back"), to(loading(0, true), load(0))],
      [failed(0), ev.of("back"), IGNORED],
    ],
    "goToStep(n)": [[failed(1), ev.go(2), to(loading(2, true), load(2))]],
    retry: F("retry", to(loading(1, true), load(1))),
  },

  finished: {
    "stepReady(i) / stepFailed(i)": [
      [finished(), ev.ready(2), LATE],
      [finished(), ev.failed(1), LATE],
    ],
    audioEnded: Fi("audioEnded", CANT),
    playBlocked: Fi("playBlocked", CANT),
    audioError: Fi("audioError", IGNORED),
    pause: Fi("pause", IGNORED),
    resume: Fi("resume", IGNORED),
    replay: Fi("replay", to(playing(2), seek)),
    ask: Fi("ask", to(asking({ kind: "finished", step: 2 }))),
    closeAsk: Fi("closeAsk", CANT),
    agentDisconnected: Fi("agentDisconnected", CANT),
    next: Fi("next", IGNORED),
    back: Fi("back", to(loading(2, true), load(2))),
    "goToStep(n)": [[finished(), ev.go(0), to(loading(0, true), load(0))]],
    retry: Fi("retry", IGNORED),
  },
};

const cells = STATES.flatMap((s) =>
  COLUMNS.map((c) => ({ name: `${s} × ${c}`, cases: TABLE[s][c] })),
);

describe("ARCH 6.1 player state x event table", () => {
  it("has a cell for every state x event pair", () => {
    expect(cells).toHaveLength(STATES.length * COLUMNS.length);
    for (const { name, cases } of cells)
      expect(cases.length, name).toBeGreaterThan(0);
  });

  it.each(cells)("$name", ({ cases }) => {
    for (const [state, event, want] of cases) check(state, event, want);
  });
});

// ---------------------------------------------------------------- bullet rules

const everyState: PlayerState[] = [
  loading(),
  playing(),
  paused(),
  stepEnded(),
  failed(),
  finished(),
  ...askOrigins.map((o) => asking(o)),
];

describe("ARCH 6.1 rules under the table", () => {
  it("goToStep(n) outside the plan is rejected in every state with 'no step n'", () => {
    for (const state of everyState) {
      for (const n of [-1, 3, 99, 1.5, Number.NaN]) {
        const got = transition(state, ev.go(n), ctx);
        expect(got.outcome).toBe("rejected");
        expect(got.state).toBe(state);
      }
      // The message names the 1-based step the agent tool asked for.
      expect(transition(state, ev.go(3), ctx)).toMatchObject({
        message: "no step 4",
      });
    }
  });

  it("when the agent jumps steps during Q&A, the new step loads paused once Ask closes", () => {
    let s = transition(playing(0), ev.of("ask"), ctx).state;
    s = transition(s, ev.go(2), ctx).state;
    expect(s.kind).toBe("asking"); // narration doesn't start while the agent talks
    const closed = transition(s, ev.of("closeAsk"), ctx);
    expect(closed).toMatchObject({
      outcome: "changed",
      state: loading(2, false),
    });
    expect(transition(closed.state, ev.ready(2), ctx).state).toEqual(paused(2));
  });

  it("playBlocked pauses with 'Press play to start', and resume plays", () => {
    const blocked = transition(playing(0), ev.of("playBlocked"), ctx);
    expect(blocked).toEqual({
      outcome: "changed",
      state: paused(0),
      effects: [notice("Press play to start")],
    });
    expect(transition(blocked.state, ev.of("resume"), ctx).state).toEqual(
      playing(0),
    );
  });

  it("a late stepReady(i) or stepFailed(i) is ignored and logged in every state", () => {
    for (const state of everyState) {
      const late = transition(state, ev.ready(7), ctx);
      expect(late).toMatchObject({ outcome: "ignored", state });
      expect(late.outcome === "ignored" && late.log).toMatch(
        /late reply for step 7/,
      );
    }
  });

  it("autoplay: yes for Next, Back and goToStep; no after a Q&A jump", () => {
    expect(transition(stepEnded(0), ev.of("next"), ctx).state).toEqual(
      loading(1, true),
    );
    expect(transition(paused(2), ev.of("back"), ctx).state).toEqual(
      loading(1, true),
    );
    expect(transition(paused(2), ev.go(0), ctx).state).toEqual(
      loading(0, true),
    );
    expect(
      transition(asking({ kind: "paused", step: 2 }, 0), ev.of("closeAsk"), ctx)
        .state,
    ).toEqual(loading(0, false));
  });
});

describe("Ask while loading (ROADMAP P4)", () => {
  it("the step arrives before Ask closes: paused at that step", () => {
    let s = loading(1, true);
    for (const e of [ev.of("ask"), ev.ready(0), ev.ready(1)])
      s = transition(s, e, ctx).state;
    expect(transition(s, ev.of("closeAsk"), ctx).state).toEqual(paused(1));
  });

  it("the step fails before Ask closes: failed with the server's message", () => {
    let s = loading(1, true);
    for (const e of [
      ev.of("ask"),
      ev.failed(1, "This step isn't in the saved run."),
    ])
      s = transition(s, e, ctx).state;
    expect(transition(s, ev.of("closeAsk"), ctx).state).toEqual(
      failed(1, "This step isn't in the saved run."),
    );
  });

  it("the step is still loading when Ask closes: stays loading and isn't requested again", () => {
    const s = transition(loading(1, true), ev.of("ask"), ctx).state;
    expect(transition(s, ev.of("closeAsk"), ctx)).toEqual({
      outcome: "changed",
      state: loading(1, true),
      effects: [restore],
    });
  });
});

describe("initialState, logResult and totality", () => {
  it("starts loading step 0 with autoplay and requests it", () => {
    expect(initialState()).toEqual({
      state: loading(0, true),
      effects: [load(0)],
    });
  });

  it("logResult warns for can't-happen, logs late replies, and is silent otherwise", () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    logResult(transition(loading(), ev.of("audioEnded"), ctx), logger);
    expect(logger.warn).toHaveBeenCalledOnce();
    logResult(transition(playing(), ev.ready(0), ctx), logger);
    expect(logger.info).toHaveBeenCalledOnce();
    logResult(transition(playing(), ev.of("pause"), ctx), logger);
    logResult(transition(failed(), ev.of("ask"), ctx), logger);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledOnce();
  });

  it("any event sequence keeps the state valid (steps in the plan)", () => {
    const event = fc.oneof(
      fc.integer({ min: -1, max: 3 }).map(ev.ready),
      fc.integer({ min: -1, max: 3 }).map((i) => ev.failed(i)),
      fc.integer({ min: -1, max: 3 }).map(ev.go),
      fc.constantFrom(
        ...(
          [
            "audioEnded",
            "playBlocked",
            "audioError",
            "pause",
            "resume",
            "replay",
            "ask",
            "closeAsk",
            "agentDisconnected",
            "next",
            "back",
            "retry",
          ] as const
        ).map(ev.of),
      ),
    );
    const inPlan = (n: number) =>
      Number.isInteger(n) && n >= 0 && n < ctx.stepCount;
    fc.assert(
      fc.property(fc.array(event, { maxLength: 40 }), (events) => {
        let s = initialState().state;
        for (const e of events) {
          s = transition(s, e, ctx).state;
          const steps =
            s.kind === "asking"
              ? [s.from.step, ...(s.goTo === undefined ? [] : [s.goTo])]
              : [s.step];
          for (const n of steps) expect(inPlan(n)).toBe(true);
        }
      }),
    );
  });
});
