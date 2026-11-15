// Types shared by the conversation adapter (qa/conversation.ts), its scripted
// fake (qa/fakeConversation.ts) and the Ask panel. No @elevenlabs/react here:
// only qa/conversation.ts imports it (ARCHITECTURE.md section 8).
import type { ClientToolName, ClientToolParams } from "@/shared/tools";

/** One line of the Ask transcript. */
export type QaMessage = { role: "user" | "agent"; text: string };

/** Why a session ended: the learner closed it, the agent ended it, or it failed. */
export type DisconnectReason = "user" | "agent" | "error";

/** What a client tool handler returns to the agent (nothing for no-wait tools). */
export type QaToolResult = string | void;

/** Client tool handlers by name, typed by shared/tools.ts. Q4 provides them. */
export type QaTools = {
  [N in ClientToolName]?: (
    params: ClientToolParams[N],
  ) => QaToolResult | Promise<QaToolResult>;
};

export type ConversationCallbacks = {
  onConnect?: () => void;
  onDisconnect?: (reason: DisconnectReason) => void;
  onMessage?: (message: QaMessage) => void;
  onError?: (message: string) => void;
  /** The server's voice activity score for the learner's mic, 0 to 1 (issue #93's barge-in). */
  onVadScore?: (score: number) => void;
  /** The agent started or stopped speaking. */
  onAgentSpeaking?: (speaking: boolean) => void;
};

/**
 * How a session reaches the agent: WebRTC with a conversation token (GET /api/agent/token),
 * or, when WebRTC is blocked (venue Wi-Fi), a websocket with a signed URL
 * (GET /api/agent/signed-url).
 */
export type Transport = "webrtc" | "websocket";

export type StartOptions = (
  | { transport: "webrtc"; conversationToken: string }
  | { transport: "websocket"; signedUrl: string }
) & {
  /** No mic: the learner types and the agent's answers come as text. */
  textOnly: boolean;
};

/** What tool handlers may ask of the Ask panel. */
export type AskApi = {
  /** Shows a tool's message in the panel (e.g. "Couldn't draw that."), or clears it with null. */
  showNotice: (message: string | null) => void;
  /** Tells the agent something through sendContextualUpdate(). */
  tellAgent: (text: string) => void;
  /** A draw_scene sketch was drawn: the card tags the answer "Drawing on the board". */
  sketchDrawn: () => void;
  /**
   * Runs `fn` once the agent has finished speaking (after a short wait for it to start if it's
   * quiet: qa/bargeIn.ts AgentTurn), so a spoken command
   * never starts the narration over the agent (issue #93).
   */
  afterAgentSpeaks: (fn: () => void) => void;
};

/**
 * What the Ask panel drives, real or fake. `start` rejects when the session can't start, and
 * `sendUserMessage` throws when the question can't be sent: the panel shows the section 7
 * message. The other calls are fire-and-forget (a failure is only logged).
 */
export type QaConversation = {
  start: (options: StartOptions) => Promise<void>;
  end: () => void;
  sendUserMessage: (text: string) => void;
  sendUserActivity: () => void;
  sendContextualUpdate: (text: string) => void;
  setMicMuted: (muted: boolean) => void;
  /** Asks for the mic; false when permission is denied or there's no mic. */
  requestMicrophone: () => Promise<boolean>;
};
