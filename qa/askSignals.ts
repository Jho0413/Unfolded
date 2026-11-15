// The learner's Ask signals (issue #102, ARCHITECTURE.md section 5.4): which questions and
// simplify requests the server records, so the upcoming step can be regenerated with them.
// No React and no browser APIs: the lesson page gives it `post` and `where`.
//
// - A learner message (a voice transcript or a typed question) is held, with where it was
//   asked, until it's known not to be a spoken lesson command: a control tool (resume_lesson,
//   go_to_step...) called for it drops it. The next message, or `flush` (Ask closed), posts it.
// - A message that only holds or steers a drawn answer while the Answer view is up ("hold on",
//   "carry on", "say that again": `isAnswerControl`) is never a question either. The agent calls
//   no tool for "hold on" there by design, so nothing would drop it (demo rehearsal, board
//   comment 6892046267: it regenerated a step "because you asked: hold on").
// - simplify_upcoming posts at once: it is never a command.
// - `flush` posts what's held and resolves, once every post so far has answered, to whether
//   any of them was recorded since the last flush: then the upcoming step is out of date.
import type { Signal } from "@/shared/lesson";
import type { ClientToolName } from "@/shared/tools";
import type { QaTools } from "./types";

/** Where the learner was: the step on screen (0-based) and ms into its audio. */
export type SignalWhere = { step: number; t: number };

export type AskSignalsDeps = {
  /** Posts a signal; resolves to whether the server recorded it (never rejects). */
  post: (signal: Signal) => Promise<boolean>;
  where: () => SignalWhere;
};

export interface AskSignals {
  /**
   * The learner said or typed something to the agent. `answerShowing`: the Answer view was up
   * (a drawn answer), where a hold or carry-on message steers the answer, not the lesson.
   */
  heard: (text: string, where?: { answerShowing?: boolean }) => void;
  /** The agent ran a lesson command for the latest message: it wasn't a question. */
  command: () => void;
  /** simplify_upcoming: the agent asked for the next step to be simpler. */
  simplify: (reason: string) => void;
  /** Posts what's held; resolves to whether anything was recorded since the last flush. */
  flush: () => Promise<boolean>;
}

/** The control tools: a learner message they answer was a command, not a question. */
export const COMMAND_TOOLS: readonly ClientToolName[] = [
  "go_to_step",
  "resume_lesson",
  "pause_lesson",
  "next_step",
  "previous_step",
  "replay_step",
];

/** Words around a command that don't make it a question ("ok, hold on please"). */
const FILLER = new Set([
  "ok",
  "okay",
  "oh",
  "um",
  "uh",
  "er",
  "hm",
  "hmm",
  "sorry",
  "hey",
  "please",
  "yes",
  "yeah",
  "yep",
  "no",
  "just",
  "now",
  "then",
  "a",
  "and",
  "so",
  "right",
]);

/** What a message that only holds, continues or replays a drawn answer says. */
const ANSWER_CONTROLS = new Set([
  "hold on",
  "hang on",
  "wait",
  "wait a sec",
  "wait a second",
  "wait a moment",
  "wait a minute",
  "one sec",
  "one second",
  "one moment",
  "pause",
  "stop",
  "carry on",
  "go on",
  "continue",
  "keep going",
  "resume",
  "go ahead",
  "say that again",
  "again",
  "repeat that",
  "play it again",
  "once more",
]);

/**
 * Whether a message only holds, continues or replays the drawn answer on screen ("hold on",
 * "ok, carry on", "say that again please"), with nothing asked. Case, punctuation and filler
 * words don't matter; anything more ("hold on, why is it squared?") is a question.
 */
export function isAnswerControl(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s']/g, " ")
    .split(/\s+/)
    .filter((w) => w !== "");
  // Drop fillers at either end only: "wait a second" keeps its "a".
  let from = 0;
  let to = words.length;
  while (from < to && FILLER.has(words[from])) from++;
  while (to > from && FILLER.has(words[to - 1])) to--;
  const core = words.slice(from, to);
  // "Wait, wait" or "hold on, hold on": the same command said twice.
  const phrase = core.join(" ");
  if (ANSWER_CONTROLS.has(phrase)) return true;
  const half = core.length / 2;
  return (
    Number.isInteger(half) &&
    half > 0 &&
    core.slice(0, half).join(" ") === core.slice(half).join(" ") &&
    ANSWER_CONTROLS.has(core.slice(0, half).join(" "))
  );
}

export function createAskSignals(deps: AskSignalsDeps): AskSignals {
  let held: { question: string; step: number; t: number } | null = null;
  let posts: Promise<boolean>[] = [];

  function send(signal: Signal) {
    posts.push(deps.post(signal));
  }
  function release() {
    if (held !== null) send(held);
    held = null;
  }

  return {
    heard: (text, where) => {
      const question = text.trim();
      if (question === "") return;
      release();
      // Holding or steering a drawn answer isn't a question (nothing is held to post).
      if (where?.answerShowing && isAnswerControl(question)) return;
      const { step, t } = deps.where();
      held = { question, step, t: Math.round(t) };
    },
    command: () => {
      held = null;
    },
    simplify: (reason) => {
      const text = reason.trim();
      if (text === "") return;
      const { step, t } = deps.where();
      send({ simplify: text, step, t: Math.round(t) });
    },
    flush: async () => {
      release();
      const pending = posts;
      posts = [];
      const recorded = await Promise.all(pending);
      return recorded.some(Boolean);
    },
  };
}

/** The tools, with every control tool noting first that its message was a command. */
export function noteCommands(tools: QaTools, command: () => void): QaTools {
  const noted: QaTools = { ...tools };
  for (const name of COMMAND_TOOLS) {
    const tool = tools[name] as ((p: never) => unknown) | undefined;
    if (tool === undefined) continue;
    (noted as Record<string, unknown>)[name] = (params: never) => {
      command();
      return tool(params);
    };
  }
  return noted;
}
