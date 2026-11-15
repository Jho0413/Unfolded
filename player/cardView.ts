// The tutor card (ARCHITECTURE.md section 5.6, its state table): what the one card on the
// board says and offers, as a pure function of the player's state, or of the Ask panel's.
// The lesson card is built by player/Player.tsx; while asking, the Ask panel (qa/AskPanel.tsx)
// builds the ask card. player/TutorCard.tsx draws either. Every button sends an existing
// machine event (player/machine.ts); the card adds no state of its own.
import type { ConnectorPhase } from "@/qa/connector";
import type { LessonCommand } from "./controls";
import { MESSAGES, type PlayerEvent, type PlayerState } from "./machine";

export const CARD_STATUS = {
  preparing: "Preparing",
  ready: "Ready when you are",
  explaining: "Explaining",
  holding: "Holding on",
  waiting: "Waiting for you",
  end: "End of the lesson",
  failed: "Stuck on this idea",
  stopped: "Stopped to listen",
  listening: "Listening",
  thinking: "Thinking",
  sketching: "Sketching",
  answering: "Answering",
  /** A spoken command ran while asking (QA A8). */
  commanded: "Got it",
} as const;

export const CARD_TEXT = {
  preparing: (title: string) => `Preparing “${title}”…`,
  start: (title: string) => `Start with “${title}” →`,
  next: (title: string) => `Next: ${title} →`,
  ideaEnded: "That's the idea. Ready for the next one?",
  lessonEnded: "That's the whole lesson. Anything you want to go over?",
  holdOn: "Hold on",
  goOn: "Go on",
  again: "Say that again",
  retry: "Retry",
  /** Ask, before any question: the mic prompt is still open (the input already works). */
  micPrompt: "Allow the mic to talk, or type your question.",
  connecting: "Connecting…",
  stopped: "I've stopped. Go ahead: ask out loud, or type below.",
  stoppedTyping: "I've stopped. Go ahead: type your question below.",
  thinking: "Thinking…",
  /** A draw_scene answer is being made (#105): nothing is drawn yet. */
  sketching: "Sketching…",
  carryOn: "Carry on",
  gotIt: "Got it, carry on",
  /** What a spoken command did, shown instead of "Thinking…" (the agent stays quiet, QA A8). */
  commanded: {
    resume: "Carrying on.",
    pause: "Holding on.",
    next: "On to the next idea.",
    previous: "Going back.",
    replay: "Saying it again.",
  } satisfies Record<LessonCommand, string>,
  askedTyped: "You asked",
  askedVoice: "You said",
  tagDrawing: "Drawing on the board",
  /** The answer highlighted the board (the `highlight` tool) and drew nothing (#91). */
  tagPointingBoard: "Pointing at the board",
  /** The answer highlighted a passage in the paper (`highlight_paper`, #106) (#91). */
  tagPointingPaper: "Pointing at the paper",
  tagSpoken: "Spoken answer",
} as const;

/** How an answer showed itself: drew, pointed at the board or the paper, or only spoke. */
export type AnswerTag = "drawing" | "board" | "paper" | "spoken";

export const TAG_TEXT: Record<AnswerTag, string> = {
  drawing: CARD_TEXT.tagDrawing,
  board: CARD_TEXT.tagPointingBoard,
  paper: CARD_TEXT.tagPointingPaper,
  spoken: CARD_TEXT.tagSpoken,
};

/**
 * The latest answer's tag (#91): a drawing wins, then pointing at the board, then at the
 * paper; an answer that did none of these is spoken.
 */
export function answerTag(answer: {
  drew: boolean;
  pointedAtBoard?: boolean;
  pointedAtPaper?: boolean;
}): AnswerTag {
  if (answer.drew) return "drawing";
  if (answer.pointedAtBoard) return "board";
  if (answer.pointedAtPaper) return "paper";
  return "spoken";
}

/** A step's title from the plan; "Idea n" where there's none (the dev player). */
export function ideaTitle(titles: readonly string[], n: number): string {
  return titles[n] ?? `Idea ${n + 1}`;
}

/** The intro before the first play, with the lesson's title set apart. */
export function introParts(
  count: number,
  lessonTitle: string | null,
): CardPart[] {
  const ideas = `${count} ${count === 1 ? "idea" : "ideas"}`;
  const rest = " I'll draw as I explain. Interrupt me any time.";
  return lessonTitle === null
    ? [{ text: `${ideas}.${rest}` }]
    : [
        { text: `${ideas} from ` },
        { text: lessonTitle, strong: true },
        { text: `.${rest}` },
      ];
}

export type CardPart = { text: string; strong?: boolean };

export type CardBody =
  /** The tutor's own words. */
  | { kind: "said"; parts: CardPart[] }
  /** The narration's current sentence (player/captions.ts). */
  | { kind: "caption" }
  | { kind: "wait"; text: string }
  /** The step failed: the machine's message (section 7). */
  | { kind: "error"; text: string }
  | {
      kind: "ask";
      question: { text: string; via: "typed" | "voice" } | null;
      /** The answer's text; null while waiting, or hidden (captions off, voice session). */
      answer: string | null;
      wait: string | null;
    };

export type CardButton<A> = { label: string; action: A; primary?: boolean };

export type CardView<A> = {
  status: string;
  /** The tutor is talking: the lesson (accent) or an answer (answer blue). */
  speaking: "lesson" | "answer" | null;
  /** Ask only: how the latest answer showed itself (answerTag). */
  tag: AnswerTag | null;
  /** The button in the card's head (Hold on / Go on; Space). */
  hold: CardButton<A> | null;
  /** Null: nothing under the head (captions off). */
  body: CardBody | null;
  buttons: CardButton<A>[];
};

export type LessonCardInput = {
  state: PlayerState;
  /** The player's notice: "Press play to start" means autoplay was blocked. */
  notice: string | null;
  /** The plan's step titles. */
  titles: readonly string[];
  stepCount: number;
  lessonTitle: string | null;
  captions: boolean;
};

const event = (e: PlayerEvent) => e;

/** The lesson card; null while asking (the Ask panel's card shows then). */
export function lessonCard(
  input: LessonCardInput,
): CardView<PlayerEvent> | null {
  const { state, titles, stepCount, captions } = input;
  const base = { speaking: null, tag: null, hold: null, buttons: [] };
  const title = (n: number) => ideaTitle(titles, n);
  const last = (n: number) => n >= stepCount - 1;
  const caption = captions ? ({ kind: "caption" } as const) : null;
  switch (state.kind) {
    case "asking":
      return null;
    case "loading":
      return {
        ...base,
        status: CARD_STATUS.preparing,
        body: { kind: "wait", text: CARD_TEXT.preparing(title(state.step)) },
      };
    case "playing":
      return {
        ...base,
        status: CARD_STATUS.explaining,
        speaking: "lesson",
        hold: { label: CARD_TEXT.holdOn, action: event({ type: "pause" }) },
        body: caption,
      };
    case "paused":
      if (input.notice === MESSAGES.pressPlay)
        return {
          ...base,
          status: CARD_STATUS.ready,
          body: {
            kind: "said",
            parts: introParts(stepCount, input.lessonTitle),
          },
          buttons: [
            {
              label: CARD_TEXT.start(title(state.step)),
              action: event({ type: "resume" }),
              primary: true,
            },
          ],
        };
      return {
        ...base,
        status: CARD_STATUS.holding,
        hold: { label: CARD_TEXT.goOn, action: event({ type: "resume" }) },
        body: caption,
      };
    case "stepEnded":
    case "finished": {
      const again = {
        label: CARD_TEXT.again,
        action: event({ type: "replay" }),
      };
      if (state.kind === "finished" || last(state.step))
        return {
          ...base,
          status: CARD_STATUS.end,
          body: { kind: "said", parts: [{ text: CARD_TEXT.lessonEnded }] },
          buttons: [again],
        };
      return {
        ...base,
        status: CARD_STATUS.waiting,
        body: { kind: "said", parts: [{ text: CARD_TEXT.ideaEnded }] },
        buttons: [
          {
            label: CARD_TEXT.next(title(state.step + 1)),
            action: event({ type: "next" }),
            primary: true,
          },
          again,
        ],
      };
    }
    case "failed":
      return {
        ...base,
        status: CARD_STATUS.failed,
        body: { kind: "error", text: state.message },
        buttons: [
          {
            label: CARD_TEXT.retry,
            action: event({ type: "retry" }),
            primary: true,
          },
          ...(last(state.step)
            ? []
            : [
                {
                  label: CARD_TEXT.next(title(state.step + 1)),
                  action: event({ type: "next" }),
                },
              ]),
        ],
      };
  }
}

export type AskCardInput = {
  phase: ConnectorPhase;
  replay: boolean;
  /** A text-only session: answers aren't spoken, so they show even with captions off. */
  textOnly: boolean;
  /** The latest question. */
  question: { text: string; via: "typed" | "voice" } | null;
  /** The agent's latest message after that question (or its greeting, before any). */
  answer: string | null;
  /** The agent called draw_scene while answering the latest question. */
  drew: boolean;
  /** A `highlight` on the board succeeded while answering the latest question (#91). */
  pointedAtBoard?: boolean;
  /** A `highlight_paper` succeeded while answering the latest question (#91). */
  pointedAtPaper?: boolean;
  /** A draw_scene answer is being made (#105): the card says "Sketching…" until it plays. */
  sketching?: boolean;
  /** The latest question was a spoken command that ran (QA A8): no answer is coming. */
  command?: LessonCommand | null;
  captions: boolean;
};

/** The one Ask action: "Got it, carry on" (closeAsk, then player/controls.ts afterAskEvent). */
export type AskAction = "carryOn";

/** The card while asking. */
export function askCard(input: AskCardInput): CardView<AskAction> {
  const { phase, question, answer } = input;
  const showText = input.captions || input.textOnly;
  const carryOn = { label: CARD_TEXT.carryOn, action: "carryOn" as const };
  const base = { tag: null, hold: null, speaking: null, buttons: [carryOn] };
  const ask = (wait: string | null, shown: string | null = null) => ({
    kind: "ask" as const,
    question,
    answer: shown,
    wait,
  });
  // No session (replay, failed, or dropped): the section 7 notice says why.
  if (input.replay || phase === "failed" || phase === "idle")
    return { ...base, status: CARD_STATUS.stopped, body: ask(null) };
  // The agent's holding line ("Let me show you.") may already be in: the answer isn't.
  if (question !== null && input.sketching)
    return {
      ...base,
      status: CARD_STATUS.sketching,
      speaking: answer === null ? null : "answer",
      body: ask(CARD_TEXT.sketching, showText ? answer : null),
    };
  // A command (carry on, say that again): the agent says nothing after one, by design.
  if (question !== null && answer === null && input.command)
    return {
      ...base,
      status: CARD_STATUS.commanded,
      body: ask(CARD_TEXT.commanded[input.command]),
    };
  if (question !== null && answer === null)
    return {
      ...base,
      status: CARD_STATUS.thinking,
      body: ask(CARD_TEXT.thinking),
    };
  if (question !== null && answer !== null)
    return {
      ...base,
      status: CARD_STATUS.answering,
      speaking: "answer",
      tag: answerTag(input),
      body: ask(null, showText ? answer : null),
      buttons: [{ label: CARD_TEXT.gotIt, action: "carryOn", primary: true }],
    };
  if (phase === "waiting")
    return {
      ...base,
      status: CARD_STATUS.stopped,
      body: ask(CARD_TEXT.micPrompt),
    };
  if (phase === "connecting")
    return {
      ...base,
      status: CARD_STATUS.stopped,
      body: ask(CARD_TEXT.connecting),
    };
  // Connected, nothing asked yet (perhaps the agent's greeting).
  const stopped = input.textOnly ? CARD_TEXT.stoppedTyping : CARD_TEXT.stopped;
  return {
    ...base,
    status: CARD_STATUS.listening,
    body: answer !== null && showText ? ask(null, answer) : ask(stopped),
  };
}
