// When the lesson keeps its voice session open (app/lesson/[lessonId]/useLessonVoice.ts,
// issue #93): from the first play until the lesson ends, and not while the tab is away.
import { describe, expect, it, vi } from "vitest";
import {
  controlLesson,
  wantsVoice,
} from "@/app/lesson/[lessonId]/useLessonVoice";
import type { LessonCommand } from "@/player/controls";
import {
  type PlayerEvent,
  type PlayerState,
  transition,
} from "@/player/machine";

const base = { started: true, away: false, stepCount: 3 };
const at = (state: PlayerState, over: Partial<typeof base> = {}) =>
  wantsVoice({ ...base, ...over, state });

describe("wantsVoice", () => {
  it("not before the lesson first plays (no gesture yet for audio and the mic)", () => {
    expect(at({ kind: "paused", step: 0 }, { started: false })).toBe(false);
  });

  it("while explaining, held on, loading, at the end of a mid-lesson step, or asking", () => {
    expect(at({ kind: "playing", step: 0 })).toBe(true);
    expect(at({ kind: "paused", step: 1 })).toBe(true);
    expect(at({ kind: "loading", step: 1, autoplay: true })).toBe(true);
    expect(at({ kind: "stepEnded", step: 1 })).toBe(true);
    expect(at({ kind: "asking", from: { kind: "playing", step: 2 } })).toBe(
      true,
    );
  });

  it("not once the lesson has ended (the last step ended, or finished), asking included", () => {
    expect(at({ kind: "stepEnded", step: 2 })).toBe(false);
    expect(at({ kind: "finished", step: 2 })).toBe(false);
    expect(at({ kind: "asking", from: { kind: "finished", step: 2 } })).toBe(
      false,
    );
  });

  it("not while the tab has been hidden for a while", () => {
    expect(at({ kind: "playing", step: 0 }, { away: true })).toBe(false);
  });
});

describe("controlLesson (a spoken command; Ask closes first, except 'hold on' with no Answer view)", () => {
  const ctx = { stepCount: 3 };
  const asking: PlayerState = {
    kind: "asking",
    from: { kind: "playing", step: 1 },
  };
  /** Runs `command` on the real machine; returns what happened. */
  function run(
    command: LessonCommand,
    start: PlayerState,
    isAnswerShowing?: () => boolean,
  ) {
    let state = start;
    const events: PlayerEvent["type"][] = [];
    const closeSession = vi.fn();
    controlLesson(command, {
      state: start,
      ctx,
      send: (event) => {
        events.push(event.type);
        const result = transition(state, event, ctx);
        state = result.state;
        return result;
      },
      closeSession,
      isAnswerShowing,
      playWhenReady: () => {},
    });
    return { events, closed: closeSession.mock.calls.length > 0, state };
  }

  const rows: [
    string,
    LessonCommand,
    PlayerState,
    (() => boolean) | undefined,
    { events: string[]; closed: boolean; kind: PlayerState["kind"] },
  ][] = [
    [
      "pause while asking, no Answer view (a sketch in flight): nothing, Ask and the view kept",
      "pause",
      asking,
      () => false,
      { events: [], closed: false, kind: "asking" },
    ],
    [
      "pause while asking, no flag wired (before #94): nothing",
      "pause",
      asking,
      undefined,
      { events: [], closed: false, kind: "asking" },
    ],
    [
      "pause while asking from the Answer view (a bare 'go back'): Ask closes, the lesson held",
      "pause",
      asking,
      () => true,
      { events: ["closeAsk"], closed: true, kind: "paused" },
    ],
    [
      "pause while explaining (not asking): pause, as before",
      "pause",
      { kind: "playing", step: 1 },
      () => false,
      { events: ["pause"], closed: false, kind: "paused" },
    ],
    [
      "resume while asking, no Answer view: Ask still closes and the lesson goes on",
      "resume",
      asking,
      () => false,
      { events: ["closeAsk", "resume"], closed: true, kind: "playing" },
    ],
    [
      "resume while asking at a step's end (QA A9): Ask closes, the next step loads",
      "resume",
      { kind: "asking", from: { kind: "stepEnded", step: 1 } },
      () => false,
      { events: ["closeAsk", "next"], closed: true, kind: "loading" },
    ],
    [
      "resume while asking at the last step's end: Ask closes, the lesson finishes",
      "resume",
      { kind: "asking", from: { kind: "stepEnded", step: 2 } },
      () => false,
      { events: ["closeAsk", "next"], closed: true, kind: "finished" },
    ],
    [
      "resume while asking after the lesson: Ask closes, nothing more",
      "resume",
      { kind: "asking", from: { kind: "finished", step: 2 } },
      () => false,
      { events: ["closeAsk"], closed: true, kind: "finished" },
    ],
    [
      "resume while asking, held on mid-step: Ask closes and the lesson goes on",
      "resume",
      { kind: "asking", from: { kind: "paused", step: 1 } },
      () => false,
      { events: ["closeAsk", "resume"], closed: true, kind: "playing" },
    ],
    [
      "replay while asking: Ask closes first, then replay",
      "replay",
      asking,
      () => false,
      { events: ["closeAsk", "replay"], closed: true, kind: "playing" },
    ],
  ];

  it.each(rows)("%s", (_name, command, start, isAnswerShowing, want) => {
    const got = run(command, start, isAnswerShowing);
    expect({
      events: got.events,
      closed: got.closed,
      kind: got.state.kind,
    }).toEqual(want);
  });
});
