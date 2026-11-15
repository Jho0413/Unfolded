// Barge-in (issue #93, ARCHITECTURE.md section 8): with the lesson's voice session open and
// Ask closed, the learner starting to speak stops the narration at once. Plain TypeScript, so
// every rule is unit-tested; qa/AskPanel.tsx feeds it the conversation's events.
//
// What counts as the learner speaking, earliest first:
// - the server's VAD score for the mic at or above VAD_THRESHOLD for VAD_HOLD_MS (one loud
//   click or a cough is shorter). The mic uses the browser's echo cancellation and noise
//   suppression (the SDK asks for both), so the narration from the speakers scores low; the
//   threshold is the second guard against what leaks through;
// - a final user transcript (the learner's words reached the agent, whatever the VAD said);
// - the agent starting to speak (it only speaks after a learner turn, so the narration must
//   never play over it).
// It fires once per arming: the panel re-arms it when Ask closes again.
//
// After a spoken command runs (resume, next, back, go to step...), the agent may still speak
// about it: its "Sure." is often a second LLM turn that starts more than ACK_WAIT_MS after the
// tool (QA A2). That speech isn't the learner, so the agent speaking doesn't count again until
// the learner's next turn (`quietAgent`, cleared by their next transcript). The learner's own
// voice (VAD, transcripts) still counts at once.

/** VAD score (0 to 1) from which a frame counts as speech. */
export const VAD_THRESHOLD = 0.8;
/** How long the score must stay at or above the threshold. */
export const VAD_HOLD_MS = 150;

export type BargeInSignal = "vad" | "transcript" | "agentSpeaking";

export class BargeIn {
  private armed = false;
  /** When the score first reached the threshold in the current run, or null. */
  private loudSince: number | null = null;
  /** A command ran and the learner hasn't spoken since: the agent speaking doesn't count. */
  private agentQuiet = false;

  constructor(
    /** What barge-in does (the panel sets it with setHandler once it can open Ask). */
    private onBargeIn: (signal: BargeInSignal) => void = () => {},
    private readonly now: () => number = () => Date.now(),
  ) {}

  setHandler(onBargeIn: (signal: BargeInSignal) => void): void {
    this.onBargeIn = onBargeIn;
  }

  /** Listen for the learner (the lesson's session is open, Ask is closed, the mic isn't muted). */
  arm(): void {
    this.armed = true;
    this.loudSince = null;
  }

  /** Stop listening (Ask opened, the mic muted, no session). */
  disarm(): void {
    this.armed = false;
    this.loudSince = null;
  }

  get isArmed(): boolean {
    return this.armed;
  }

  /**
   * A spoken command just ran: until the learner's next turn (a non-empty transcript), the
   * agent speaking (about the command) doesn't count. Kept across arm and disarm.
   */
  quietAgent(): void {
    this.agentQuiet = true;
  }

  vad(score: number): void {
    if (!this.armed) return;
    if (score < VAD_THRESHOLD) {
      this.loudSince = null;
      return;
    }
    const t = this.now();
    this.loudSince ??= t;
    if (t - this.loudSince >= VAD_HOLD_MS) this.fire("vad");
  }

  /** A final transcript of the learner's words. Empty ones (noise) don't count. */
  transcript(text: string): void {
    if (text.trim() === "") return;
    this.agentQuiet = false;
    this.fire("transcript");
  }

  agentSpeaking(speaking: boolean): void {
    if (speaking && !this.agentQuiet) this.fire("agentSpeaking");
  }

  private fire(signal: BargeInSignal): void {
    if (!this.armed) return;
    this.disarm();
    this.onBargeIn(signal);
  }
}

/** A spoken command waits at most this long for the agent to finish speaking. */
export const AGENT_SPEAKING_CAP_MS = 10_000;
/**
 * A command that arrives while the agent is quiet waits this long for it to start speaking:
 * the agent often calls the tool first and says "Sure." after, and the narration must not
 * start under that (it would count as barge-in and stop the lesson again).
 */
export const ACK_WAIT_MS = 2_000;

/**
 * Runs spoken commands once the agent has finished speaking (its "Sure." before the narration
 * starts again): when it stops, or after ACK_WAIT_MS if it never starts, or after
 * AGENT_SPEAKING_CAP_MS if the "listening" event is lost.
 */
export class AgentTurn {
  private speaking = false;
  private queue: (() => void)[] = [];

  constructor(
    private readonly setTimer: (fn: () => void, ms: number) => unknown = (
      fn,
      ms,
    ) => setTimeout(fn, ms),
  ) {}

  get isSpeaking(): boolean {
    return this.speaking;
  }

  setSpeaking(speaking: boolean): void {
    this.speaking = speaking;
    if (!speaking) this.flush();
  }

  after(fn: () => void): void {
    this.queue.push(fn);
    const run = () => {
      if (!this.queue.includes(fn)) return;
      this.queue = this.queue.filter((f) => f !== fn);
      fn();
    };
    this.setTimer(run, AGENT_SPEAKING_CAP_MS);
    if (!this.speaking)
      this.setTimer(() => {
        if (!this.speaking) run();
      }, ACK_WAIT_MS);
  }

  private flush(): void {
    const queued = this.queue;
    this.queue = [];
    for (const fn of queued) fn();
  }
}
