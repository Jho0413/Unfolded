// player/cardView.ts: one test per row of the tutor-card state table (ARCHITECTURE.md
// section 5.6), named after the row.
import { describe, expect, it } from "vitest";
import { MESSAGES, type PlayerState } from "@/player/machine";
import {
  type AskCardInput,
  answerTag,
  askCard,
  CARD_STATUS,
  CARD_TEXT,
  type LessonCardInput,
  lessonCard,
  TAG_TEXT,
} from "@/player/cardView";

const TITLES = ["Rows", "Columns", "Products"];
const lesson = (
  state: PlayerState,
  more: Partial<LessonCardInput> = {},
): LessonCardInput => ({
  state,
  notice: null,
  titles: TITLES,
  stepCount: TITLES.length,
  lessonTitle: "Matrix multiplication",
  captions: true,
  ...more,
});
const labels = (v: ReturnType<typeof lessonCard>) =>
  v?.buttons.map((b) => [b.label, b.action, b.primary ?? false]);

describe("lessonCard", () => {
  it("loading(k): Preparing, “Preparing <title>…”, no buttons", () => {
    const v = lessonCard(lesson({ kind: "loading", step: 1, autoplay: true }));
    expect(v).toEqual({
      status: CARD_STATUS.preparing,
      speaking: null,
      tag: null,
      hold: null,
      body: { kind: "wait", text: "Preparing “Columns”…" },
      buttons: [],
    });
  });

  it("paused with “Press play to start” (autoplay blocked): the intro and Start with <title>", () => {
    const v = lessonCard(
      lesson({ kind: "paused", step: 0 }, { notice: MESSAGES.pressPlay }),
    );
    expect(v?.status).toBe(CARD_STATUS.ready);
    expect(v?.body).toEqual({
      kind: "said",
      parts: [
        { text: "3 ideas from " },
        { text: "Matrix multiplication", strong: true },
        { text: ". I'll draw as I explain. Interrupt me any time." },
      ],
    });
    expect(labels(v)).toEqual([
      ["Start with “Rows” →", { type: "resume" }, true],
    ]);
    expect(v?.hold).toBeNull();
  });

  it("the intro with one step and no lesson title (the dev player)", () => {
    const v = lessonCard(
      lesson(
        { kind: "paused", step: 0 },
        {
          notice: MESSAGES.pressPlay,
          titles: [],
          stepCount: 1,
          lessonTitle: null,
        },
      ),
    );
    expect(v?.body).toEqual({
      kind: "said",
      parts: [
        { text: "1 idea. I'll draw as I explain. Interrupt me any time." },
      ],
    });
    expect(labels(v)?.[0]?.[0]).toBe("Start with “Idea 1” →");
  });

  it("playing: Explaining, the caption, Hold on (pause)", () => {
    const v = lessonCard(lesson({ kind: "playing", step: 0 }));
    expect(v?.status).toBe(CARD_STATUS.explaining);
    expect(v?.speaking).toBe("lesson");
    expect(v?.body).toEqual({ kind: "caption" });
    expect(v?.hold).toEqual({ label: "Hold on", action: { type: "pause" } });
    expect(v?.buttons).toEqual([]);
  });

  it("paused: Holding on, the caption, Go on (resume)", () => {
    const v = lessonCard(lesson({ kind: "paused", step: 2 }));
    expect(v?.status).toBe(CARD_STATUS.holding);
    expect(v?.body).toEqual({ kind: "caption" });
    expect(v?.hold).toEqual({ label: "Go on", action: { type: "resume" } });
  });

  it("paused with another notice (Q&A ended): Holding on, not the intro", () => {
    const v = lessonCard(
      lesson({ kind: "paused", step: 0 }, { notice: MESSAGES.qaEnded }),
    );
    expect(v?.status).toBe(CARD_STATUS.holding);
  });

  it("captions off: playing and paused have no caption", () => {
    for (const state of [
      { kind: "playing", step: 0 },
      { kind: "paused", step: 0 },
    ] as const)
      expect(lessonCard(lesson(state, { captions: false }))?.body).toBeNull();
  });

  it("stepEnded (not the last): the idea's done, Next: <next title> (next) and Say that again (replay)", () => {
    const v = lessonCard(lesson({ kind: "stepEnded", step: 0 }));
    expect(v?.status).toBe(CARD_STATUS.waiting);
    expect(v?.body).toEqual({
      kind: "said",
      parts: [{ text: CARD_TEXT.ideaEnded }],
    });
    expect(labels(v)).toEqual([
      ["Next: Columns →", { type: "next" }, true],
      ["Say that again", { type: "replay" }, false],
    ]);
  });

  it("stepEnded on the last step: the whole lesson, Say that again only", () => {
    const v = lessonCard(lesson({ kind: "stepEnded", step: 2 }));
    expect(v?.status).toBe(CARD_STATUS.end);
    expect(v?.body).toEqual({
      kind: "said",
      parts: [{ text: CARD_TEXT.lessonEnded }],
    });
    expect(labels(v)).toEqual([["Say that again", { type: "replay" }, false]]);
  });

  it("finished: as the last step's end", () => {
    const v = lessonCard(lesson({ kind: "finished", step: 2 }));
    expect(v?.status).toBe(CARD_STATUS.end);
    expect(labels(v)).toEqual([["Say that again", { type: "replay" }, false]]);
  });

  it("failed (not the last): the message, Retry (retry) and Next: <next title> (next, skips it)", () => {
    const v = lessonCard(
      lesson({ kind: "failed", step: 0, message: "Couldn't make this step." }),
    );
    expect(v?.status).toBe(CARD_STATUS.failed);
    expect(v?.body).toEqual({
      kind: "error",
      text: "Couldn't make this step.",
    });
    expect(labels(v)).toEqual([
      ["Retry", { type: "retry" }, true],
      ["Next: Columns →", { type: "next" }, false],
    ]);
  });

  it("failed on the last step: Retry only", () => {
    const v = lessonCard(
      lesson({ kind: "failed", step: 2, message: MESSAGES.audioFailed }),
    );
    expect(labels(v)).toEqual([["Retry", { type: "retry" }, true]]);
  });

  it("asking: no lesson card (the Ask panel's card shows)", () => {
    expect(
      lessonCard(
        lesson({ kind: "asking", from: { kind: "playing", step: 0 } }),
      ),
    ).toBeNull();
  });
});

const ask = (more: Partial<AskCardInput> = {}): AskCardInput => ({
  phase: "connected",
  replay: false,
  textOnly: false,
  question: null,
  answer: null,
  drew: false,
  captions: true,
  ...more,
});
const typed = { text: "Why a row?", via: "typed" as const };
const carryOn = [{ label: "Carry on", action: "carryOn" }];

describe("askCard", () => {
  it("replay: Stopped to listen, nothing asked, Carry on (the notice says Q&A needs a connection)", () => {
    const v = askCard(ask({ replay: true, phase: "idle" }));
    expect(v.status).toBe(CARD_STATUS.stopped);
    expect(v.body).toEqual({
      kind: "ask",
      question: null,
      answer: null,
      wait: null,
    });
    expect(v.buttons).toEqual(carryOn);
  });

  it("failed (no session, or it dropped): Stopped to listen, Retry (retry), Carry on", () => {
    const v = askCard(ask({ phase: "failed", question: typed }));
    expect(v.status).toBe(CARD_STATUS.stopped);
    expect(v.body).toMatchObject({ question: typed, wait: null });
    expect(v.buttons).toEqual([
      { label: "Retry", action: "retry", primary: true },
      ...carryOn,
    ]);
  });

  it("dropped (phase idle while open, not replay): Stopped to listen, nothing waiting, Carry on", () => {
    const v = askCard(ask({ phase: "idle", question: typed, answer: "So." }));
    expect(v.status).toBe(CARD_STATUS.stopped);
    expect(v.tag).toBeNull();
    expect(v.body).toEqual({
      kind: "ask",
      question: typed,
      answer: null,
      wait: null,
    });
    expect(v.buttons).toEqual(carryOn);
  });

  it("waiting (mic prompt open), nothing asked: the mic hint", () => {
    const v = askCard(ask({ phase: "waiting" }));
    expect(v.status).toBe(CARD_STATUS.stopped);
    expect(v.body).toMatchObject({ wait: CARD_TEXT.micPrompt });
  });

  it("connecting, nothing asked: Connecting…", () => {
    const v = askCard(ask({ phase: "connecting" }));
    expect(v.status).toBe(CARD_STATUS.stopped);
    expect(v.body).toMatchObject({ wait: CARD_TEXT.connecting });
  });

  it("connected, nothing asked: Listening, ask out loud or type", () => {
    expect(askCard(ask()).status).toBe(CARD_STATUS.listening);
    expect(askCard(ask()).body).toMatchObject({ wait: CARD_TEXT.stopped });
    expect(askCard(ask({ textOnly: true })).body).toMatchObject({
      wait: CARD_TEXT.stoppedTyping,
    });
  });

  it("connected, the agent's greeting before any question: shown, no tag", () => {
    const v = askCard(ask({ answer: "Hi!" }));
    expect(v.status).toBe(CARD_STATUS.listening);
    expect(v.tag).toBeNull();
    expect(v.body).toMatchObject({ answer: "Hi!", wait: null });
  });

  it("a question with no answer yet (queued or sent): Thinking, You asked: <q>", () => {
    for (const phase of ["waiting", "connecting", "connected"] as const) {
      const v = askCard(ask({ phase, question: typed }));
      expect(v.status).toBe(CARD_STATUS.thinking);
      expect(v.body).toEqual({
        kind: "ask",
        question: typed,
        answer: null,
        wait: CARD_TEXT.thinking,
      });
    }
  });

  it.each([
    ["resume", "Carrying on."],
    ["replay", "Saying it again."],
    ["pause", "Holding on."],
    ["next", "On to the next idea."],
    ["previous", "Going back."],
  ] as const)(
    "a spoken command (%s) that ran, with no answer (the agent stays quiet, QA A8): Got it, %s, not Thinking",
    (command, text) => {
      const said = { text: "carry on", via: "voice" as const };
      const v = askCard(ask({ question: said, command }));
      expect(v.status).toBe(CARD_STATUS.commanded);
      expect(v.body).toEqual({
        kind: "ask",
        question: said,
        answer: null,
        wait: text,
      });
      expect(CARD_TEXT.commanded[command]).toBe(text);
      expect(v.buttons).toEqual(carryOn);
    },
  );

  it("a command the agent answers anyway shows the answer as usual", () => {
    const v = askCard(
      ask({ question: typed, command: "resume", answer: "Sure." }),
    );
    expect(v.status).toBe(CARD_STATUS.answering);
  });

  it("answered, no draw_scene: Answering, Spoken answer, the answer, Got it, carry on", () => {
    const v = askCard(ask({ question: typed, answer: "Because." }));
    expect(v.status).toBe(CARD_STATUS.answering);
    expect(v.speaking).toBe("answer");
    expect(v.tag).toBe("spoken");
    expect(v.body).toMatchObject({ question: typed, answer: "Because." });
    expect(v.buttons).toEqual([
      { label: "Got it, carry on", action: "carryOn", primary: true },
    ]);
  });

  it("a question with a draw_scene answer being made (#105): Sketching, Sketching…, nothing drawn yet", () => {
    const v = askCard(ask({ question: typed, sketching: true }));
    expect(v.status).toBe(CARD_STATUS.sketching);
    expect(v.body).toEqual({
      kind: "ask",
      question: typed,
      answer: null,
      wait: CARD_TEXT.sketching,
    });
    expect(v.tag).toBeNull();
    expect(v.buttons).toEqual([
      { label: CARD_TEXT.carryOn, action: "carryOn" },
    ]);
  });

  it("Sketching… with the agent's holding line already in: the line shows too", () => {
    const v = askCard(
      ask({ question: typed, answer: "Let me show you.", sketching: true }),
    );
    expect(v.status).toBe(CARD_STATUS.sketching);
    expect(v.speaking).toBe("answer");
    expect(v.body).toMatchObject({
      answer: "Let me show you.",
      wait: CARD_TEXT.sketching,
    });
  });

  it("answered with draw_scene: Drawing on the board", () => {
    expect(
      askCard(ask({ question: typed, answer: "Look.", drew: true })).tag,
    ).toBe("drawing");
  });

  describe("the answer's tag (issue #91): one row per case", () => {
    const tagOf = (more: Partial<AskCardInput>) =>
      askCard(ask({ question: typed, answer: "So.", ...more })).tag;
    it.each([
      ["drew", { drew: true }, "drawing"],
      [
        "drew and pointed at the board",
        { drew: true, pointedAtBoard: true },
        "drawing",
      ],
      [
        "drew and pointed at the paper",
        { drew: true, pointedAtPaper: true },
        "drawing",
      ],
      ["pointed at the board only", { pointedAtBoard: true }, "board"],
      [
        "pointed at the board and the paper",
        { pointedAtBoard: true, pointedAtPaper: true },
        "board",
      ],
      ["pointed at the paper only", { pointedAtPaper: true }, "paper"],
      ["neither drew nor pointed", {}, "spoken"],
    ] as const)("%s: %s", (_, more, tag) => {
      expect(tagOf(more)).toBe(tag);
      expect(answerTag({ drew: false, ...more })).toBe(tag);
    });

    it("each tag has its words", () => {
      expect(TAG_TEXT).toEqual({
        drawing: "Drawing on the board",
        board: "Pointing at the board",
        paper: "Pointing at the document",
        spoken: "Spoken answer",
      });
    });

    it("no tag before the answer, or while it is being sketched", () => {
      expect(tagOf({ answer: null, pointedAtBoard: true })).toBeNull();
      expect(tagOf({ sketching: true, pointedAtBoard: true })).toBeNull();
    });
  });

  it("a spoken question keeps its via (You said)", () => {
    const voice = { text: "why", via: "voice" as const };
    expect(askCard(ask({ question: voice, answer: "So." })).body).toMatchObject(
      { question: voice },
    );
  });

  it("captions off in a voice session: the answer text is hidden", () => {
    const v = askCard(ask({ question: typed, answer: "So.", captions: false }));
    expect(v.body).toMatchObject({ answer: null });
    expect(v.tag).toBe("spoken");
  });

  it("captions off in a text-only session: the answer still shows (it isn't spoken)", () => {
    const v = askCard(
      ask({ question: typed, answer: "So.", captions: false, textOnly: true }),
    );
    expect(v.body).toMatchObject({ answer: "So." });
  });
});
