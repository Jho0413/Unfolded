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

/** A token that makes `start` fail as if the agent couldn't connect (tests). */
export const FAKE_CONNECT_FAIL_TOKEN = "fake-connect-fail";

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
  readonly contextUpdates: string[] = [];
  readonly transcript: QaMessage[] = [];
  readonly toolCalls: FakeToolCall[] = [];
  userActivity = 0;
  /** Bumped by end(), so a start still in flight doesn't connect. */
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

  async start({ conversationToken, textOnly }: StartOptions): Promise<void> {
    if (this.status === "connected") return;
    const session = ++this.session;
    await tick();
    if (session !== this.session) return;
    if (conversationToken === FAKE_CONNECT_FAIL_TOKEN) {
      this.callbacks.onError?.("Could not connect to the agent");
      this.callbacks.onDisconnect?.("error");
      return;
    }
    this.status = "connected";
    this.textOnly = textOnly;
    this.micMuted = textOnly;
    this.callbacks.onConnect?.();
    this.emit({ role: "agent", text: FAKE_GREETING });
  }

  end(): void {
    this.session++;
    this.close("user");
  }

  /** Test hook: the session drops, as a network failure would. */
  drop(): void {
    this.close("error");
  }

  async sendUserMessage(text: string): Promise<void> {
    if (this.status !== "connected") return;
    this.emit({ role: "user", text });
    const turn = this.script.find((t) => t.match.test(text));
    if (!turn) return;
    if (turn.tool) {
      const { name } = turn.tool;
      const params = toolParams(turn, text, this.contextUpdates.at(-1));
      const result = await callTool(this.tools, name, params);
      this.toolCalls.push({ name, params, result });
    }
    await tick();
    if (this.status !== "connected") return;
    this.emit({ role: "agent", text: turn.reply });
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
