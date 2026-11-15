// The scripted fake conversation (ARCHITECTURE.md sections 8 and 10), used when
// the build has NEXT_PUBLIC_FAKE_APIS=1. It replays canned agent turns and
// calls the client tool handlers directly, so Playwright can test Q&A without
// a network. Plain TypeScript, no React: qa/conversation.ts wraps it in a hook.
import { OBJECT_ID_RE } from "@/shared/scene";
import type { ClientToolName } from "@/shared/tools";
import { callTool } from "./callTool";
import type {
  ConversationCallbacks,
  DisconnectReason,
  QaMessage,
  QaTools,
  StartOptions,
} from "./types";

/** A token whose WebRTC `start` rejects, as the SDK's does when WebRTC is blocked (tests). */
export const FAKE_CONNECT_FAIL_TOKEN = "fake-connect-fail";
/** A signed URL whose websocket `start` rejects too (tests). */
export const FAKE_CONNECT_FAIL_SIGNED_URL = "wss://fake-connect-fail";
/** A token whose WebRTC `start` never settles, as on venue Wi-Fi that drops it (tests). */
export const FAKE_CONNECT_HANG_TOKEN = "fake-connect-hang";

/** One canned agent turn: the first whose `match` fits the question answers it. */
export type FakeTurn = {
  match: RegExp;
  /** Called before the reply; its result is recorded in `toolCalls`. */
  tool?: { name: ClientToolName; params: Record<string, unknown> };
  reply: string;
};

export const FAKE_GREETING = "Hi! What would you like to know?";

export const DEFAULT_SCRIPT: readonly FakeTurn[] = [
  {
    match: /\bstep (\d+)\b/i,
    tool: { name: "go_to_step", params: { step: 1 } },
    reply: "Sure, we'll go there once you close this.",
  },
  // The learner's spoken commands (issue #93).
  {
    match: /\b(carry on|go on|continue)\b/i,
    tool: { name: "resume_lesson", params: {} },
    reply: "Sure.",
  },
  {
    match: /\b(hold on|pause)\b/i,
    tool: { name: "pause_lesson", params: {} },
    reply: "Okay, holding on.",
  },
  {
    match: /\b(skip ahead|next step)\b/i,
    tool: { name: "next_step", params: {} },
    reply: "Moving on.",
  },
  {
    match: /\b(go back|previous step)\b/i,
    tool: { name: "previous_step", params: {} },
    reply: "Going back.",
  },
  {
    match: /\bsay that again\b/i,
    tool: { name: "replay_step", params: {} },
    reply: "Once more.",
  },
  {
    match: /first row/i,
    tool: { name: "highlight", params: { target_id: "q", row: 0 } },
    reply: "Here's the first row, highlighted.",
  },
  {
    match: /\bdraw\b/i,
    tool: {
      name: "draw_scene",
      params: { description: "Circle the first row of q", fresh: false },
    },
    reply: "Let me sketch that while I explain.",
  },
  {
    match: /.*/,
    reply: "Good question. Each output cell is a row times a column.",
  },
];

export type FakeToolCall = {
  name: ClientToolName;
  params: Record<string, unknown>;
  result: unknown;
};

export class FakeConversation {
  status: "disconnected" | "connected" = "disconnected";
  textOnly = false;
  micMuted = false;
  /** How the current or last session connected. */
  transport: StartOptions["transport"] | null = null;
  /** Every start, in order (tests check the fallback). */
  readonly starts: StartOptions["transport"][] = [];
  readonly contextUpdates: string[] = [];
  readonly transcript: QaMessage[] = [];
  readonly toolCalls: FakeToolCall[] = [];
  userActivity = 0;
  /** Bumped by start() and end(), so a superseded start doesn't connect. */
  private session = 0;

  constructor(
    private callbacks: ConversationCallbacks,
    private tools: QaTools = {},
    private script: readonly FakeTurn[] = DEFAULT_SCRIPT,
  ) {}

  /** Lets the React wrapper keep the latest callbacks and tools. */
  update(callbacks: ConversationCallbacks, tools: QaTools): void {
    this.callbacks = callbacks;
    this.tools = tools;
  }

  /**
   * Like the real adapter (qa/sdkSessions.ts): a start supersedes any earlier session, pending
   * or live, without waiting for it; it resolves once connected and rejects when the connection
   * fails (the SDK reports no onError or onDisconnect then).
   */
  async start(options: StartOptions): Promise<void> {
    this.end();
    const session = ++this.session;
    this.starts.push(options.transport);
    if (
      options.transport === "webrtc" &&
      options.conversationToken === FAKE_CONNECT_HANG_TOKEN
    )
      return new Promise<void>(() => {});
    await tick();
    if (session !== this.session) return;
    const blocked =
      options.transport === "webrtc"
        ? options.conversationToken === FAKE_CONNECT_FAIL_TOKEN
        : options.signedUrl === FAKE_CONNECT_FAIL_SIGNED_URL;
    if (blocked) throw new Error("fake: could not connect to the agent");
    this.status = "connected";
    this.transport = options.transport;
    const { textOnly } = options;
    this.textOnly = textOnly;
    this.micMuted = textOnly;
    this.callbacks.onConnect?.();
    this.emit({ role: "agent", text: FAKE_GREETING });
  }

  /** Ends the session, live or connecting; like the real adapter, its callbacks stop. */
  end(): void {
    this.session++;
    this.status = "disconnected";
  }

  /** Test hook: the session drops, as a network failure would. */
  drop(): void {
    this.close("error");
  }

  /** Throws (synchronously) without a session, as the SDK does; resolves once answered. */
  sendUserMessage(text: string): Promise<void> {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error("fake: the session is broken");
    }
    if (this.status !== "connected") throw new Error("fake: no active session");
    return this.answer(text);
  }

  /** Test hook: the next sendUserMessage throws, as the SDK would on a broken session. */
  failNextSend = false;

  /**
   * Test hook: the learner speaks into the mic (a voice session). The server's VAD scores the
   * speech first, then the transcript arrives and the agent answers, as for a typed question.
   */
  async say(text: string): Promise<void> {
    if (this.status !== "connected" || this.textOnly || this.micMuted) return;
    // Scores about every 100 ms, as the server sends them; speech lasts a few frames.
    for (const score of [0.2, 0.9, 0.95, 0.97]) {
      this.callbacks.onVadScore?.(score);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (this.status !== "connected") return;
    await this.answer(text);
  }

  /** Test hook: one VAD score (e.g. the narration leaking into the mic, scored low). */
  vad(score: number): void {
    if (this.status === "connected") this.callbacks.onVadScore?.(score);
  }

  private async answer(text: string): Promise<void> {
    this.emit({ role: "user", text });
    const turn = this.script.find((t) => t.match.test(text));
    if (!turn) return;
    // The agent speaks its reply; a no-wait tool is called during it, as the real agent does.
    this.callbacks.onAgentSpeaking?.(true);
    if (turn.tool) {
      const { name } = turn.tool;
      const params = toolParams(turn, text, this.contextUpdates.at(-1));
      const result = await callTool(this.tools, name, params);
      this.toolCalls.push({ name, params, result });
    }
    await tick();
    if (this.status !== "connected") return;
    this.emit({ role: "agent", text: turn.reply });
    await tick();
    if (this.status === "connected") this.callbacks.onAgentSpeaking?.(false);
  }

  sendUserActivity(): void {
    if (this.status === "connected") this.userActivity++;
  }

  sendContextualUpdate(text: string): void {
    if (this.status === "connected") this.contextUpdates.push(text);
  }

  setMicMuted(muted: boolean): void {
    // A text-only session has no mic to unmute.
    this.micMuted = this.textOnly || muted;
  }

  /** Test hook: the agent ends the session normally. */
  hangUp(): void {
    this.close("agent");
  }

  private close(reason: DisconnectReason): void {
    if (this.status !== "connected") return;
    this.status = "disconnected";
    this.callbacks.onDisconnect?.(reason);
  }

  private emit(message: QaMessage): void {
    this.transcript.push(message);
    this.callbacks.onMessage?.(message);
  }
}

/**
 * `go_to_step` takes the step the question names; `highlight` the first id
 * the latest context offers (so it works on any board); other tools use the
 * script's params.
 */
function toolParams(
  turn: FakeTurn,
  text: string,
  context: string | undefined,
): Record<string, unknown> {
  if (turn.tool?.name === "highlight") {
    const id = CONTEXT_FIRST_ID.exec(context ?? "")?.[1];
    return id
      ? { ...turn.tool.params, target_id: id }
      : { ...turn.tool.params };
  }
  if (turn.tool?.name !== "go_to_step") return { ...turn.tool?.params };
  const n = Number(turn.match.exec(text)?.[1]);
  return Number.isInteger(n) ? { step: n } : { ...turn.tool.params };
}

/** The first id in a context's "ids for highlight" list (OBJECT_ID_RE without its anchors). */
const CONTEXT_FIRST_ID = new RegExp(
  `ids for highlight\\): (${OBJECT_ID_RE.source.replace(/^\^|\$$/g, "")})`,
);

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
