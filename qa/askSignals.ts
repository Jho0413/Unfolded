// The learner's Ask signals (issue #102, ARCHITECTURE.md section 5.4): which questions and
// simplify requests the server records, so the upcoming step can be regenerated with them.
// No React and no browser APIs: the lesson page gives it `post` and `where`.
//
// - A learner message (a voice transcript or a typed question) is held, with where it was
//   asked, until it's known not to be a spoken lesson command: a control tool (resume_lesson,
//   go_to_step...) called for it drops it. The next message, or `flush` (Ask closed), posts it.
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
  /** The learner said or typed something to the agent. */
  heard: (text: string) => void;
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
    heard: (text) => {
      const question = text.trim();
      if (question === "") return;
      release();
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
