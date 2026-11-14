// The Ask panel's connection (ARCHITECTURE.md sections 7 and 8, issue #84). Plain TypeScript
// with injected effects, so every path is unit-tested; qa/AskPanel.tsx renders its state.
//
// - Typed questions never wait on the mic. Opening Ask fetches a token and asks for the mic in
//   parallel. Whichever comes first decides the session: mic granted -> a voice session; mic
//   denied -> text-only, with "Mic is off…"; the learner focuses or types first (the browser's
//   mic prompt still unanswered) -> text-only at once. A text-only session can switch to voice
//   later (useMic), from a click, which is when the browser may ask.
// - A question sent before the session connects is queued and sent on connect.
// - Each attempt has a generation: after every await, a stale attempt (the panel closed,
//   failed, or started another) stops, so nothing starts after the panel has given up.
// - WebRTC first; if it fails before connecting (blocked on venue Wi-Fi: start rejects, an
//   error or a disconnect arrives, or it takes longer than ATTEMPT_TIMEOUT_MS), the same session
//   is retried once over a websocket with a signed URL. A websocket that worked is kept for
//   later sessions on this page.
// - Failures are logged and shown with the section 7 messages: "Questions are unavailable right
//   now." when no session starts, "Q&A ended unexpectedly." when a question can't be sent.
import { MESSAGES } from "@/player/machine";
import { QA_UNAVAILABLE } from "@/shared/lesson";
import type {
  DisconnectReason,
  QaConversation,
  StartOptions,
  Transport,
} from "./types";

/** How long one connect attempt may take before it counts as failed. */
export const ATTEMPT_TIMEOUT_MS = 8000;

export const CONNECTOR_MESSAGES = {
  unavailable: QA_UNAVAILABLE,
  ended: MESSAGES.qaEnded,
  micOff: "Mic is off. Type your question; the answer will appear as text.",
} as const;

/**
 * waiting: the token or the mic answer hasn't come yet (the input already works).
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
  onConnected: () => void;
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

export class AskConnector {
  private state: ConnectorState = INITIAL_CONNECTOR_STATE;
  private gen = 0;
  private queue: string[] = [];
  /** Set once the mode is decided for the current open (typing or the mic answer). */
  private decide: ((textOnly: boolean) => void) | null = null;
  private timer: unknown = null;
  private attempt: { textOnly: boolean; transport: Transport } | null = null;
  private preferWebsocket = false;
  private readonly setTimer;
  private readonly clearTimer;

  constructor(private readonly deps: ConnectorDeps) {
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      deps.clearTimer ??
      ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get current(): ConnectorState {
    return this.state;
  }

  /** Ask opened: start deciding the session (voice if the mic comes first, else text). */
  open(): void {
    const gen = this.begin();
    this.set({ ...INITIAL_CONNECTOR_STATE, phase: "waiting" });
    const decided = new Promise<boolean>((resolve) => (this.decide = resolve));
    void this.deps.requestMicrophone().then(
      (mic) => {
        if (gen !== this.gen || this.decide === null) return;
        if (!mic)
          this.set({ micDenied: true, notice: CONNECTOR_MESSAGES.micOff });
        this.decideMode(!mic);
      },
      (err: unknown) => {
        this.deps.log.warn("[qa] mic request failed", err);
        if (gen !== this.gen || this.decide === null) return;
        this.set({ micDenied: true, notice: CONNECTOR_MESSAGES.micOff });
        this.decideMode(true);
      },
    );
    void (async () => {
      const textOnly = await decided;
      if (gen !== this.gen) return;
      await this.connect(gen, textOnly);
    })();
  }

  /** The learner focused or typed in the input: don't wait for the mic any longer. */
  typing(): void {
    this.decideMode(true);
  }

  /** Switch a text-only session to voice (a click, so the browser may ask for the mic). */
  async useMic(): Promise<void> {
    const gen = this.begin();
    this.deps.conversation.end();
    this.set({ phase: "waiting", notice: null });
    const mic = await this.deps.requestMicrophone().catch(() => false);
    if (gen !== this.gen) return;
    if (!mic) this.set({ micDenied: true, notice: CONNECTOR_MESSAGES.micOff });
    await this.connect(gen, !mic);
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

  /** A typed question: sent now if connected, queued while connecting. False if it failed. */
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
    if (this.state.phase !== "connecting" || this.attempt === null) {
      // A connect that lands after Ask closed, failed or moved on is ended at once.
      this.deps.conversation.end();
      return;
    }
    this.stopTimer();
    if (this.attempt.transport === "websocket") this.preferWebsocket = true;
    this.set({ phase: "connected", transport: this.attempt.transport });
    this.deps.onConnected();
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

  private decideMode(textOnly: boolean): void {
    const decide = this.decide;
    if (decide === null) return;
    this.decide = null;
    if (textOnly) this.set({ textOnly: true });
    decide(textOnly);
  }

  private async connect(gen: number, textOnly: boolean): Promise<void> {
    this.set({ phase: "connecting", textOnly });
    await this.tryTransport(
      gen,
      textOnly,
      this.preferWebsocket ? "websocket" : "webrtc",
    );
  }

  private async tryTransport(
    gen: number,
    textOnly: boolean,
    transport: Transport,
  ): Promise<void> {
    const options = await this.credentials(transport, textOnly);
    if (gen !== this.gen) return;
    if (options === null) {
      this.deps.log.error(`[qa] no ${transport} credentials`);
      return this.attemptFailedFor(transport, textOnly);
    }
    this.attempt = { textOnly, transport };
    this.stopTimer();
    this.timer = this.setTimer(() => {
      if (gen === this.gen && this.state.phase === "connecting")
        this.attemptFailed(
          `${transport} took longer than ${ATTEMPT_TIMEOUT_MS} ms`,
        );
    }, ATTEMPT_TIMEOUT_MS);
    try {
      await this.deps.conversation.start(options);
    } catch (err) {
      if (gen !== this.gen || this.attempt?.transport !== transport) return;
      this.deps.log.error(`[qa] ${transport} session failed to start`, err);
      this.attemptFailed(`${transport} start rejected`);
    }
  }

  private async credentials(
    transport: Transport,
    textOnly: boolean,
  ): Promise<StartOptions | null> {
    if (transport === "webrtc") {
      const conversationToken = await this.deps.fetchToken();
      return conversationToken === null
        ? null
        : { transport, conversationToken, textOnly };
    }
    const signedUrl = await this.deps.fetchSignedUrl();
    return signedUrl === null ? null : { transport, signedUrl, textOnly };
  }

  /** The current attempt failed before connecting: fall back to the websocket once, or fail. */
  private attemptFailed(why: string): void {
    const attempt = this.attempt;
    if (attempt === null) return;
    this.deps.log.warn(`[qa] ${attempt.transport} attempt failed: ${why}`);
    this.attemptFailedFor(attempt.transport, attempt.textOnly);
  }

  private attemptFailedFor(transport: Transport, textOnly: boolean): void {
    this.stopTimer();
    this.attempt = null;
    this.deps.conversation.end();
    if (transport === "webrtc") {
      this.deps.log.info("[qa] trying the websocket connection instead");
      // A fresh generation, so the abandoned WebRTC attempt can't report back.
      void this.tryTransport(++this.gen, textOnly, "websocket");
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
