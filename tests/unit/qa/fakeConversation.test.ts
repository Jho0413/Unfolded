// The scripted fake conversation (ARCHITECTURE.md sections 8 and 10).
import { describe, expect, it, vi } from "vitest";
import {
  FAKE_CONNECT_FAIL_TOKEN,
  FAKE_CONNECT_HANG_TOKEN,
  FAKE_GREETING,
  FakeConversation,
} from "@/qa/fakeConversation";
import type { ConversationCallbacks, QaMessage } from "@/qa/types";

function setup(tools = {}) {
  const messages: QaMessage[] = [];
  const cb = {
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onError: vi.fn(),
    onMessage: (m: QaMessage) => messages.push(m),
  } satisfies ConversationCallbacks;
  return { fake: new FakeConversation(cb, tools), cb, messages };
}

describe("FakeConversation", () => {
  it("connects and greets", async () => {
    const { fake, cb, messages } = setup();
    await fake.start({
      transport: "webrtc",
      conversationToken: "t",
      textOnly: false,
    });
    expect(cb.onConnect).toHaveBeenCalledOnce();
    expect(fake.status).toBe("connected");
    expect(messages).toEqual([{ role: "agent", text: FAKE_GREETING }]);
  });

  it("rejects with the fail token, like the SDK (no onError, no onDisconnect)", async () => {
    const { fake, cb } = setup();
    await expect(
      fake.start({
        transport: "webrtc",
        conversationToken: FAKE_CONNECT_FAIL_TOKEN,
        textOnly: false,
      }),
    ).rejects.toThrow();
    expect(cb.onConnect).not.toHaveBeenCalled();
    expect(cb.onError).not.toHaveBeenCalled();
    expect(cb.onDisconnect).not.toHaveBeenCalled();
  });

  it("a hung start doesn't block the next one", async () => {
    const { fake, cb } = setup();
    void fake.start({
      transport: "webrtc",
      conversationToken: FAKE_CONNECT_HANG_TOKEN,
      textOnly: true,
    });
    fake.end();
    await fake.start({
      transport: "websocket",
      signedUrl: "wss://signed",
      textOnly: true,
    });
    expect(cb.onConnect).toHaveBeenCalledOnce();
    expect(fake.transport).toBe("websocket");
    expect(fake.starts).toEqual(["webrtc", "websocket"]);
  });

  it("replays a canned answer to a typed question", async () => {
    const { fake, messages } = setup();
    await fake.start({
      transport: "webrtc",
      conversationToken: "t",
      textOnly: false,
    });
    await fake.sendUserMessage("What is this?");
    expect(messages.slice(1)).toEqual([
      { role: "user", text: "What is this?" },
      { role: "agent", text: expect.stringContaining("row times a column") },
    ]);
  });

  it("calls tool handlers and records their results", async () => {
    const highlight = vi.fn(() => "ok");
    const goTo = vi.fn(() => "no step 9");
    const { fake } = setup({ highlight, go_to_step: goTo });
    await fake.start({
      transport: "webrtc",
      conversationToken: "t",
      textOnly: false,
    });
    await fake.sendUserMessage("show me the first row");
    await fake.sendUserMessage("go to step 9");
    expect(highlight).toHaveBeenCalledWith({ target_id: "q", row: 0 });
    expect(goTo).toHaveBeenCalledWith({ step: 9 });
    expect(fake.toolCalls.map((c) => c.result)).toEqual(["ok", "no step 9"]);
  });

  it("highlights the first id the latest context offers", async () => {
    const highlight = vi.fn(() => "ok");
    const { fake } = setup({ highlight });
    await fake.start({
      transport: "webrtc",
      conversationToken: "t",
      textOnly: false,
    });
    fake.sendContextualUpdate("Objects on the board (ids for highlight): a, b");
    await fake.sendUserMessage("show me the first row");
    expect(highlight).toHaveBeenCalledWith({ target_id: "a", row: 0 });
  });

  it("tells the agent when a tool has no handler", async () => {
    const { fake } = setup();
    await fake.start({
      transport: "webrtc",
      conversationToken: "t",
      textOnly: false,
    });
    await fake.sendUserMessage("show me the first row");
    expect(fake.toolCalls[0].result).toBe('tool "highlight" isn\'t available');
  });

  it("records context updates, user activity and the mic", async () => {
    const { fake } = setup();
    fake.sendContextualUpdate("before connect");
    await fake.start({
      transport: "webrtc",
      conversationToken: "t",
      textOnly: false,
    });
    fake.sendContextualUpdate("ctx");
    fake.sendUserActivity();
    fake.setMicMuted(true);
    expect(fake.contextUpdates).toEqual(["ctx"]);
    expect(fake.userActivity).toBe(1);
    expect(fake.micMuted).toBe(true);
    fake.setMicMuted(false);
    expect(fake.micMuted).toBe(false);
  });

  it("keeps a text-only session's mic muted", async () => {
    const { fake } = setup();
    await fake.start({
      transport: "webrtc",
      conversationToken: "t",
      textOnly: true,
    });
    fake.setMicMuted(false);
    expect(fake.textOnly).toBe(true);
    expect(fake.micMuted).toBe(true);
  });

  it("reports a drop as error, once; our own end() reports nothing", async () => {
    const { fake, cb } = setup();
    await fake.start({
      transport: "webrtc",
      conversationToken: "t",
      textOnly: false,
    });
    fake.drop();
    fake.end();
    expect(cb.onDisconnect.mock.calls).toEqual([["error"]]);
    await fake.start({
      transport: "webrtc",
      conversationToken: "t",
      textOnly: false,
    });
    fake.end();
    expect(cb.onDisconnect.mock.calls).toEqual([["error"]]);
    expect(fake.status).toBe("disconnected");
  });

  it("reports hangUp as agent", async () => {
    const { fake, cb } = setup();
    await fake.start({
      transport: "webrtc",
      conversationToken: "t",
      textOnly: false,
    });
    fake.hangUp();
    expect(cb.onDisconnect.mock.calls).toEqual([["agent"]]);
    expect(fake.status).toBe("disconnected");
  });

  it("sends no answer after the session drops mid-question", async () => {
    const { fake, messages } = setup();
    await fake.start({
      transport: "webrtc",
      conversationToken: "t",
      textOnly: false,
    });
    const pending = fake.sendUserMessage("Why?");
    fake.drop();
    await pending;
    expect(messages.at(-1)).toEqual({ role: "user", text: "Why?" });
  });
});

describe("FakeConversation end during connect", () => {
  it("doesn't connect when ended before the connect lands", async () => {
    const { fake, cb } = setup();
    const pending = fake.start({
      transport: "webrtc",
      conversationToken: "t",
      textOnly: false,
    });
    fake.end();
    await pending;
    expect(cb.onConnect).not.toHaveBeenCalled();
    expect(fake.status).toBe("disconnected");
  });
});
