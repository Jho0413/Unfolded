// The Ask panel's connection (ARCHITECTURE.md sections 7 and 8, issue #84). Plain TypeScript
// with injected effects, so every path is unit-tested; qa/AskPanel.tsx renders its state.
//
// - Typed questions never wait on the mic. Opening Ask fetches the credentials and asks for the
//   mic in parallel. The mic answer or the learner's typing decides the session: mic granted ->
//   voice; mic denied -> text-only, with "Mic is off…"; the learner focuses or types first (the
//   browser's mic prompt still unanswered) -> text-only at once. A text-only session can switch
//   to voice later (useMic, a click, which is when the browser may ask).
// - A question sent before the session connects is queued and sent after the context on connect.
//   A switch to voice that fails on both transports goes back to a text session.
// - Each attempt has a generation: after every await, a stale attempt (the panel closed,
//   failed, or moved on) stops, so nothing starts after the panel has given up.
// - WebRTC first (or the transport that last worked on this page). If it fails before
//   connecting (no credentials, the start rejects, an error or a disconnect arrives, or it takes
//   longer than ATTEMPT_TIMEOUT_MS, credentials included), the other transport is tried once, at
//   once: a websocket with a signed URL when WebRTC is blocked on venue Wi-Fi. The conversation
//   starts each session fresh (qa/sdkSessions.ts), so a hung WebRTC start can't block it, and
//   the abandoned start's late callbacks are dropped there and ignored here.
// - Failures are logged and shown with the section 7 messages: "Questions are unavailable right
//   now." when no session starts, "Q&A ended unexpectedly." when a session drops or a question
//   can't be sent.
import { MESSAGES } from "@/player/machine";
import { QA_UNAVAILABLE } from "@/shared/lesson";
import type {
  DisconnectReason,
  QaConversation,
  StartOptions,
  Transport,
} from "./types";

/** How long one connect attempt may take, credentials included, before it counts as failed. */
export const ATTEMPT_TIMEOUT_MS = 8000;

export const CONNECTOR_MESSAGES = {
  unavailable: QA_UNAVAILABLE,
  ended: MESSAGES.qaEnded,
  micOff: "Mic is off. Type your question; the answer will appear as text.",
  voiceFailed:
    "Voice couldn't connect. Keep typing; the answer will appear as text.",
} as const;

/**
 * waiting: the mic answer hasn't come and the learner hasn't typed (the input already works).
 * connecting: a session is starting. failed: no session could start.
 */
export type ConnectorPhase =
  "idle" | "waiting" | "connecting" | "connected" | "failed";

export type ConnectorState = {
  phase: ConnectorPhase;
  textOnly: boolean;
  /** Whether the mic was refused (so "Use the mic" isn't offered). */
  micDenied: boolean;
  transport: Transport | null;
  notice: string | null;
};

export type ConnectorDeps = {
  conversation: Pick<QaConversation, "start" | "end" | "sendUserMessage">;
  /** GET /api/agent/token: a WebRTC conversation token, or null on any failure. */
  fetchToken: () => Promise<string | null>;
  /** GET /api/agent/signed-url: a websocket signed URL, or null on any failure. */
  fetchSignedUrl: () => Promise<string | null>;
  requestMicrophone: () => Promise<boolean>;
  onState: (state: ConnectorState) => void;
  /** The session connected: send the agent its context (queued questions follow). */
  onConnected: (state: ConnectorState) => void;
  /** A connected session dropped, or a question couldn't be sent: the machine's agentDisconnected. */
  onDropped: () => void;
  /** The agent ended the session normally: close Ask. */
  onAgentEnded: () => void;
  log: Pick<Console, "error" | "warn" | "info">;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export const INITIAL_CONNECTOR_STATE: ConnectorState = {
  phase: "idle",
  textOnly: false,
  micDenied: false,
  transport: null,
  notice: null,
};

/** One connect attempt; on failure before connecting, `canFallBack` tries the other transport. */
type Attempt = {
  transport: Transport;
  textOnly: boolean;
  canFallBack: boolean;
  /** A text session switching to voice: if voice fails everywhere, back to text. */
  micSwitch: boolean;
};

type Credentials =
  | { transport: "webrtc"; conversationToken: string }
  | { transport: "websocket"; signedUrl: string };

const other = (t: Transport): Transport =>
  t === "webrtc" ? "websocket" : "webrtc";

export class AskConnector {
  private state: ConnectorState = INITIAL_CONNECTOR_STATE;
  private gen = 0;
  private queue: string[] = [];
  /** Set until the mode is decided for the current open (typing or the mic answer). */
  private decide: ((textOnly: boolean) => void) | null = null;
  private timer: unknown = null;
  /** The attempt whose callbacks count; null between attempts (callbacks are then stale). */
  private attempt: Attempt | null = null;
  private preferred: Transport = "webrtc";
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly deps: ConnectorDeps) {
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      deps.clearTimer ??
      ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get current(): ConnectorState {
    return this.state;
  }

  /** Ask opened: fetch credentials and ask for the mic in parallel; the first answer decides. */
  open(): void {
    const gen = this.begin();
    this.set({ ...INITIAL_CONNECTOR_STATE, phase: "waiting" });
    const decided = new Promise<boolean>((resolve) => (this.decide = resolve));
    // Fetched now, not after the mic answer; a failure shows up when the attempt uses it.
    const transport = this.preferred;
    const credentials = this.credentials(transport).catch(() => null);
    void this.deps.requestMicrophone().then(
      (mic) => this.micAnswered(gen, mic),
      (err: unknown) => {
        this.deps.log.warn("[qa] mic request failed", err);
        this.micAnswered(gen, false);
      },
    );
    void (async () => {
      const textOnly = await decided;
      if (gen !== this.gen) return;
      this.set({ phase: "connecting", textOnly });
      await this.tryTransport(
        gen,
        { transport, textOnly, canFallBack: true, micSwitch: false },
        credentials,
      );
    })();
  }

  /** The learner focused or typed in the input: don't wait for the mic any longer. */
  typing(): void {
    this.decideMode(true);
  }

  /**
   * Switch a text-only session to voice (a click, so the browser may ask for the mic). The
   * working session is ended only once the mic is granted.
   */
  async useMic(): Promise<void> {
    const gen = this.gen;
    const mic = await this.deps.requestMicrophone().catch(() => false);
    if (gen !== this.gen || this.state.phase !== "connected") return;
    if (!mic) {
      this.set({ micDenied: true, notice: CONNECTOR_MESSAGES.micOff });
      return;
    }
    const next = this.begin();
    this.deps.conversation.end();
    this.set({ phase: "connecting", textOnly: false, notice: null });
    const transport = this.preferred;
    await this.tryTransport(
      next,
      { transport, textOnly: false, canFallBack: true, micSwitch: true },
      this.credentials(transport).catch(() => null),
    );
  }

  /** Ask closed: drop everything in flight, end the session. */
  close(): void {
    this.begin();
    this.queue = [];
    this.deps.conversation.end();
    // Only a dropped session's message outlives the panel.
    const notice =
      this.state.notice === CONNECTOR_MESSAGES.ended
        ? CONNECTOR_MESSAGES.ended
        : null;
    this.set({ ...INITIAL_CONNECTOR_STATE, notice });
  }

  /** Clears a leftover notice (Ask opened again). */
  clearNotice(): void {
    this.set({ notice: null });
  }

  /** A typed question: sent now if connected, queued until then. False if it failed. */
  send(text: string): boolean {
    const { phase } = this.state;
    if (phase === "waiting" || phase === "connecting") {
      this.decideMode(true);
      this.queue.push(text);
      return true;
    }
    if (phase !== "connected") return false;
    return this.sendNow(text);
  }

  // ---- conversation callbacks

  connected(): void {
    const attempt = this.attempt;
    if (this.state.phase !== "connecting" || attempt === null) {
      // A connect that lands after Ask closed, failed or moved on is ended at once.
      this.deps.conversation.end();
      return;
    }
    this.stopTimer();
    this.preferred = attempt.transport;
    this.set({ phase: "connected", transport: attempt.transport });
    this.deps.onConnected(this.state);
    const queued = this.queue;
    this.queue = [];
    for (const text of queued) if (!this.sendNow(text)) break;
  }

  disconnected(reason: DisconnectReason): void {
    const { phase } = this.state;
    if (phase === "connecting") {
      // "user" is the end() of an attempt we abandoned ourselves.
      if (reason !== "user")
        this.attemptFailed(`disconnected (${reason}) before connecting`);
    } else if (phase === "connected") {
      this.set({ phase: "idle" });
      if (reason === "error") {
        this.deps.log.error("[qa] the session dropped");
        this.set({ notice: CONNECTOR_MESSAGES.ended });
        this.deps.onDropped();
      } else if (reason === "agent") {
        this.deps.onAgentEnded();
      }
    }
  }

  error(message: string): void {
    this.deps.log.error("[qa]", message);
    if (this.state.phase === "connecting") this.attemptFailed(message);
  }

  // ---- internals

  private begin(): number {
    this.stopTimer();
    this.decide = null;
    this.attempt = null;
    return ++this.gen;
  }

  private micAnswered(gen: number, mic: boolean): void {
    if (gen !== this.gen) return;
    // Recorded even after typing decided text-only, so "Use the mic" isn't offered after a refusal.
    if (!mic) {
      const undecided = this.decide !== null;
      this.set({
        micDenied: true,
        ...(undecided && { notice: CONNECTOR_MESSAGES.micOff }),
      });
    }
    this.decideMode(!mic);
  }

  private decideMode(textOnly: boolean): void {
    const decide = this.decide;
    if (decide === null) return;
    this.decide = null;
    if (textOnly) this.set({ textOnly: true });
    decide(textOnly);
  }

  private async credentials(transport: Transport): Promise<Credentials | null> {
    if (transport === "webrtc") {
      const conversationToken = await this.deps.fetchToken();
      return conversationToken === null
        ? null
        : { transport, conversationToken };
    }
    const signedUrl = await this.deps.fetchSignedUrl();
    return signedUrl === null ? null : { transport, signedUrl };
  }

  private async tryTransport(
    gen: number,
    attempt: Attempt,
    credentials: Promise<Credentials | null>,
  ): Promise<void> {
    const fail = (why: string) => {
      if (gen !== this.gen) return;
      this.deps.log.warn(`[qa] ${attempt.transport} attempt failed: ${why}`);
      this.attemptFailedFor(attempt);
    };
    // The timer covers the credentials too: a hung token route still ends in a message.
    this.stopTimer();
    this.timer = this.setTimer(() => {
      if (gen === this.gen && this.state.phase === "connecting")
        fail(`took longer than ${ATTEMPT_TIMEOUT_MS} ms`);
    }, ATTEMPT_TIMEOUT_MS);
    const creds = await credentials;
    if (gen !== this.gen) return;
    if (creds === null) return fail("no credentials");
    this.attempt = attempt;
    const options: StartOptions = { ...creds, textOnly: attempt.textOnly };
    try {
      // Resolves once connected; rejects when the connection fails (e.g. WebRTC blocked).
      await this.deps.conversation.start(options);
    } catch (err) {
      if (gen !== this.gen) return;
      this.deps.log.error(
        `[qa] ${attempt.transport} session failed to start`,
        err,
      );
      fail("start rejected");
    }
  }

  /** The current attempt failed before connecting (an error or a disconnect callback). */
  private attemptFailed(why: string): void {
    const attempt = this.attempt;
    if (attempt === null) return; // a stale callback from an abandoned attempt
    this.deps.log.warn(`[qa] ${attempt.transport} attempt failed: ${why}`);
    this.attemptFailedFor(attempt);
  }

  private attemptFailedFor(failed: Attempt): void {
    this.stopTimer();
    this.attempt = null;
    this.deps.conversation.end();
    // A fresh generation each time, so the abandoned attempt can't report back.
    if (failed.canFallBack) {
      const transport = other(failed.transport);
      this.deps.log.info(`[qa] trying the ${transport} connection instead`);
      void this.tryTransport(
        ++this.gen,
        { ...failed, transport, canFallBack: false },
        this.credentials(transport).catch(() => null),
      );
      return;
    }
    if (failed.micSwitch) {
      // Voice failed on both transports: back to typing, as before the click.
      this.deps.log.info("[qa] voice failed; back to a text session");
      const transport = this.preferred;
      this.set({ textOnly: true, notice: CONNECTOR_MESSAGES.voiceFailed });
      void this.tryTransport(
        ++this.gen,
        { transport, textOnly: true, canFallBack: true, micSwitch: false },
        this.credentials(transport).catch(() => null),
      );
      return;
    }
    this.queue = [];
    this.set({ phase: "failed", notice: CONNECTOR_MESSAGES.unavailable });
  }

  private sendNow(text: string): boolean {
    try {
      this.deps.conversation.sendUserMessage(text);
      return true;
    } catch (err) {
      this.deps.log.error("[qa] couldn't send the question", err);
      this.queue = [];
      this.begin();
      this.deps.conversation.end();
      this.set({ phase: "idle", notice: CONNECTOR_MESSAGES.ended });
      this.deps.onDropped();
      return false;
    }
  }

  private stopTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private set(patch: Partial<ConnectorState>): void {
    this.state = { ...this.state, ...patch };
    this.deps.onState(this.state);
  }
}
