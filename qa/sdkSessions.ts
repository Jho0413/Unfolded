// One SDK conversation per start (ARCHITECTURE.md section 8, issue #84). Plain TypeScript with
// the SDK's start injected, so qa/conversation.ts is the only file that imports the SDK and
// every path here is unit-tested.
//
// Why not @elevenlabs/react's ConversationProvider: its startSession() silently returns while an
// earlier start is still pending, and endSession() doesn't release that lock. A WebRTC start
// that hangs (blocked venue Wi-Fi) would block the websocket fallback. Here each start is its
// own @elevenlabs/client Conversation.startSession(), which resolves once connected and rejects
// when the connection fails. Nothing waits on an earlier start: a start supersedes any earlier
// session, pending or live. A superseded or ended start that resolves late is ended at once, and
// its callbacks are dropped.
import type {
  ConversationCallbacks,
  DisconnectReason,
  StartOptions,
} from "./types";

/** The parts of an @elevenlabs/client conversation we use. */
export type SdkConversation = {
  endSession: () => Promise<void>;
  sendUserMessage: (text: string) => void;
  sendUserActivity: () => void;
  sendContextualUpdate: (text: string) => void;
  setMicMuted: (muted: boolean) => void;
};

/** The SDK callbacks one start gets (already bound to that start). */
export type SdkCallbacks = {
  onConversationCreated: (conversation: SdkConversation) => void;
  onConnect: () => void;
  onDisconnect: (details: { reason: DisconnectReason }) => void;
  onMessage: (message: { message: string; role: "user" | "agent" }) => void;
  onError: (message: string) => void;
  onVadScore: (event: { vadScore: number }) => void;
  onModeChange: (event: { mode: "speaking" | "listening" }) => void;
};

/** Starts one SDK conversation: resolves once connected, rejects when it can't connect. */
export type SdkStart = (
  options: StartOptions,
  callbacks: SdkCallbacks,
) => Promise<SdkConversation>;

export class SdkSessions {
  /** Bumped by every start and end: a start whose id is old is superseded. */
  private id = 0;
  private conversation: SdkConversation | null = null;

  constructor(
    private readonly startSdk: SdkStart,
    /** The latest callbacks (the hook's props change between renders). */
    private readonly callbacks: () => ConversationCallbacks,
    private readonly log: Pick<Console, "warn">,
  ) {}

  /** Starts a fresh session, ending any earlier one. Rejects when it can't connect. */
  async start(options: StartOptions): Promise<void> {
    this.end();
    const id = ++this.id;
    const live = () => id === this.id;
    const cb = this.callbacks;
    const conversation = await this.startSdk(options, {
      // Created just before onConnect, so a question sent from onConnect has a session.
      onConversationCreated: (c) => {
        if (live()) this.conversation = c;
      },
      onConnect: () => {
        if (live()) cb().onConnect?.();
      },
      onDisconnect: ({ reason }) => {
        if (!live()) return;
        this.conversation = null;
        cb().onDisconnect?.(reason);
      },
      onMessage: ({ message, role }) => {
        if (live()) cb().onMessage?.({ role, text: message });
      },
      onError: (message) => {
        if (live()) cb().onError?.(message);
      },
      onVadScore: ({ vadScore }) => {
        if (live()) cb().onVadScore?.(vadScore);
      },
      onModeChange: ({ mode }) => {
        if (live()) cb().onAgentSpeaking?.(mode === "speaking");
      },
    }).catch((err: unknown) => {
      // A superseded start's failure is nobody's business.
      if (live()) throw err;
      return null;
    });
    if (conversation === null) return;
    if (!live()) {
      // Ended or superseded while it was connecting: it must not stay open.
      this.endQuietly(conversation);
      return;
    }
    this.conversation = conversation;
  }

  /** Ends the session, live or still connecting; its callbacks stop. */
  end(): void {
    this.id++;
    const conversation = this.conversation;
    this.conversation = null;
    if (conversation !== null) this.endQuietly(conversation);
  }

  /** Throws without a connected session: the panel says Q&A ended (section 7). */
  sendUserMessage(text: string): void {
    if (this.conversation === null) throw new Error("no active Q&A session");
    this.conversation.sendUserMessage(text);
  }

  // Fire-and-forget: without a session (e.g. a blur after a drop) a failure is only logged.
  sendUserActivity(): void {
    this.quietly((c) => c.sendUserActivity());
  }

  sendContextualUpdate(text: string): void {
    this.quietly((c) => c.sendContextualUpdate(text));
  }

  setMicMuted(muted: boolean): void {
    this.quietly((c) => c.setMicMuted(muted));
  }

  private quietly(call: (c: SdkConversation) => void): void {
    if (this.conversation === null) return;
    try {
      call(this.conversation);
    } catch (err) {
      this.log.warn("[qa]", err);
    }
  }

  private endQuietly(conversation: SdkConversation): void {
    conversation
      .endSession()
      .catch((err: unknown) => this.log.warn("[qa] ending the session", err));
  }
}
