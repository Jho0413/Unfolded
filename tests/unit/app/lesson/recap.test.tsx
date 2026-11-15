// The end-of-lesson recap (issue #130, app/lesson/[lessonId]/recap.ts and LessonRecap.tsx).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  RECAP_TEXT,
  atLessonEnd,
  recapQuestion,
  recapView,
  replayEvent,
  type RecapInput,
} from "@/app/lesson/[lessonId]/recap";
import { LessonRecap } from "@/app/lesson/[lessonId]/LessonRecap";
import type { AdaptedFrom } from "@/shared/lesson";

const titles = ["Matrices", "Row times column", "Attention"];
const asked: AdaptedFrom = {
  kind: "question",
  text: "why divide by root d?",
  atStep: 0,
};
const simpler: AdaptedFrom = { kind: "simplify", text: "simpler", atStep: 1 };
const input = (more: Partial<RecapInput> = {}): RecapInput => ({
  titles,
  played: [0, 1, 2],
  questions: [],
  adapted: new Map(),
  ...more,
});

describe("recapView", () => {
  it("every idea played: all of them, in plan order, each once", () => {
    const v = recapView(input({ played: [2, 0, 1, 0, 2] }));
    expect(v.coveredHeading).toBe("Ideas covered (all 3)");
    expect(v.steps).toEqual([
      { n: 0, title: "Matrices", adapted: false },
      { n: 1, title: "Row times column", adapted: false },
      { n: 2, title: "Attention", adapted: false },
    ]);
  });

  it("a skipped idea isn't covered: N of M", () => {
    const v = recapView(input({ played: [0, 2] }));
    expect(v.coveredHeading).toBe("Ideas covered (2 of 3)");
    expect(v.steps.map((s) => s.n)).toEqual([0, 2]);
  });

  it("the questions, oldest first, with the idea they were asked on", () => {
    const v = recapView(
      input({
        questions: [
          { text: "what is a row?", step: 0 },
          { text: "and softmax?", step: 2 },
        ],
      }),
    );
    expect(v.questions).toEqual([
      { text: "what is a row?", step: 0, title: "Matrices" },
      { text: "and softmax?", step: 2, title: "Attention" },
    ]);
  });

  it("adapted steps say why, as the marker does; only the ones played", () => {
    const v = recapView(
      input({
        played: [0, 1, 2],
        adapted: new Map([
          [2, simpler],
          [1, asked],
        ]),
      }),
    );
    expect(v.adapted).toEqual([
      {
        n: 1,
        title: "Row times column",
        because: "Updated because you asked: “why divide by root d?”",
      },
      { n: 2, title: "Attention", because: "Made simpler because you asked" },
    ]);
    expect(v.steps.map((s) => s.adapted)).toEqual([false, true, true]);
    expect(
      recapView(input({ played: [0], adapted: new Map([[1, asked]]) })).adapted,
    ).toEqual([]);
  });

  it("an idea outside the plan is dropped; an untitled one is 'Idea n'", () => {
    const v = recapView(input({ titles: ["A"], played: [0, 3] }));
    expect(v.steps).toEqual([{ n: 0, title: "A", adapted: false }]);
    expect(recapView(input({ titles: [], played: [] })).questions).toEqual([]);
  });
});

describe("atLessonEnd", () => {
  it.each([
    ["the last step ended", { kind: "stepEnded", step: 2 }, true],
    ["the lesson finished", { kind: "finished", step: 2 }, true],
    ["an earlier step ended", { kind: "stepEnded", step: 1 }, false],
    ["the last step playing", { kind: "playing", step: 2 }, false],
    [
      "asking at the end (the Ask card shows instead)",
      { kind: "asking", from: { kind: "finished", step: 2 } },
      false,
    ],
  ] as const)("%s: %s", (_, state, shown) => {
    expect(atLessonEnd(state, 3)).toBe(shown);
  });
});

describe("replayEvent", () => {
  it("the idea on screen: replay it from the start; another: jump to it", () => {
    expect(replayEvent(2, { kind: "finished", step: 2 })).toEqual({
      type: "replay",
    });
    expect(replayEvent(0, { kind: "stepEnded", step: 2 })).toEqual({
      type: "goToStep",
      n: 0,
    });
  });
});

describe("recapQuestion", () => {
  it("a question signal is a question; simplify and started aren't", () => {
    expect(recapQuestion({ question: "why?", step: 1, t: 200 })).toEqual({
      text: "why?",
      step: 1,
    });
    expect(recapQuestion({ question: "why?" })).toEqual({ text: "why?" });
    expect(recapQuestion({ simplify: "simpler", step: 1, t: 0 })).toBeNull();
    expect(recapQuestion({ started: 1, version: 2 })).toBeNull();
  });
});

describe("LessonRecap", () => {
  const html = (more: Partial<RecapInput>) =>
    renderToStaticMarkup(
      <LessonRecap
        view={recapView(input(more))}
        state={{ kind: "finished", step: 2 }}
        send={() => {}}
        onClose={() => {}}
      />,
    );

  it("a replay link per idea, per question and per adapted step, labelled with its idea", () => {
    const out = html({
      questions: [{ text: "what is a row?", step: 0 }],
      adapted: new Map([[1, asked]]),
    });
    expect(out.match(/data-testid="recap-replay"/g)).toHaveLength(3 + 1 + 1);
    expect(out).toContain(
      `aria-label="${RECAP_TEXT.replayLabel(1, "Row times column")}"`,
    );
    expect(out).toContain("“what is a row?”");
    expect(out).toContain('data-testid="recap-adapted"');
  });

  it("no questions: says so; nothing adapted: no adapted section", () => {
    const out = html({});
    expect(out).toContain(RECAP_TEXT.noQuestions);
    expect(out).not.toContain('data-testid="recap-adapted"');
    expect(out).toContain(`aria-label="${RECAP_TEXT.close}"`);
  });
});
