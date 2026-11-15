// The spoken commands the help overlay (#131) lists. The voice agent understands them through
// its client tools (shared/tools.ts CLIENT_TOOLS, handled in qa/tools.ts), so the list is
// keyed by tool name: a new tool fails the typecheck until it is listed here or named in
// NOT_COMMANDS, and a test checks the two cover CLIENT_TOOLS exactly.
import type { ClientToolName } from "@/shared/tools";

/** Tools the agent uses on its own, not commands a learner says. */
export const NOT_COMMANDS = [
  "highlight",
  "draw_scene",
  "highlight_paper",
  "simplify_upcoming",
] as const satisfies readonly ClientToolName[];

type CommandTool = Exclude<ClientToolName, (typeof NOT_COMMANDS)[number]>;

export interface SpokenCommand {
  /** What a learner might say: examples, since the agent understands paraphrases. */
  say: readonly string[];
  does: string;
}

/** By tool, in the order the help lists them. */
export const SPOKEN_COMMANDS: Record<CommandTool, SpokenCommand> = {
  pause_lesson: {
    say: ["Hold on", "Wait"],
    does: "Holds the lesson where it is",
  },
  resume_lesson: {
    say: ["Carry on", "Go on"],
    does: "Carries on; at the end of an idea, starts the next one",
  },
  next_step: { say: ["Next", "Skip ahead"], does: "Starts the next idea" },
  previous_step: { say: ["Go back"], does: "Starts the previous idea" },
  replay_step: {
    say: ["Say that again"],
    does: "Explains this idea again from the start",
  },
  go_to_step: { say: ["Go to step 3"], does: "Jumps to that idea" },
};
