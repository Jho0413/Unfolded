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
};

export type StartOptions = {
  conversationToken: string;
  /** No mic: the agent's answers come as text (mic permission denied). */
  textOnly: boolean;
};

/** What tool handlers may ask of the Ask panel. */
export type AskApi = {
  /** Shows a tool's message in the panel (e.g. "Couldn't draw that."), or clears it with null. */
  showNotice: (message: string | null) => void;
  /** Tells the agent something through sendContextualUpdate(). */
  tellAgent: (text: string) => void;
};

/** What the Ask panel drives, real or fake. Every call is fire-and-forget. */
export type QaConversation = {
  start: (options: StartOptions) => void;
  end: () => void;
  sendUserMessage: (text: string) => void;
  sendUserActivity: () => void;
  sendContextualUpdate: (text: string) => void;
  setMicMuted: (muted: boolean) => void;
  /** Asks for the mic; false when permission is denied or there's no mic. */
  requestMicrophone: () => Promise<boolean>;
};
