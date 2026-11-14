// One SDK conversation per start (qa/sdkSessions.ts, issue #84): a hung WebRTC start never
// blocks the websocket fallback, a start ended or superseded while connecting is ended when it
// lands, and its callbacks are dropped.
import { describe, expect, it, vi } from "vitest";
import {
  type SdkCallbacks,
  type SdkConversation,
  SdkSessions,
  type SdkStart,
} from "@/qa/sdkSessions";
import type { ConversationCallbacks, StartOptions } from "@/qa/types";

const WEBRTC: StartOptions = {
  transport: "webrtc",
  conversationToken: "tok",
  textOnly: true,
};
const WEBSOCKET: StartOptions = {
  transport: "websocket",
  signedUrl: "wss://signed",
  textOnly: true,
};

function sdkConversation(): SdkConversation {
  return {
    endSession: vi.fn(async () => {}),
    sendUserMessage: vi.fn(),
    sendUserActivity: vi.fn(),
    sendContextualUpdate: vi.fn(),
    setMicMuted: vi.fn(),
  };
}

/** A fake SDK start per call; each can be connected, failed, or left hanging. */
function setup() {
  const calls: {
    options: StartOptions;
    cb: SdkCallbacks;
    connect: () => SdkConversation;
    fail: (err: unknown) => void;
  }[] = [];
  const startSdk: SdkStart = (options, cb) =>
    new Promise((resolve, reject) => {
      calls.push({
        options,
        cb,
        connect: () => {
          const c = sdkConversation();
          cb.onConversationCreated(c);
          cb.onConnect();
          resolve(c);
          return c;
        },
        fail: reject,
      });
    });
  const callbacks = {
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onMessage: vi.fn(),
    onError: vi.fn(),
  } satisfies ConversationCallbacks;
  const log = { warn: vi.fn() };
  const sessions = new SdkSessions(startSdk, () => callbacks, log);
  return { sessions, calls, callbacks, log };
}

describe("SdkSessions", () => {
  it("WebRTC hangs, is ended, and the websocket start still connects", async () => {
    const { sessions, calls, callbacks } = setup();
    void sessions.start(WEBRTC); // never settles
    sessions.end(); // the connector's timeout
    const ws = sessions.start(WEBSOCKET);
    expect(calls.map((c) => c.options.transport)).toEqual([
      "webrtc",
      "websocket",
    ]);
    const conv = calls[1].connect();
    await ws;
    expect(callbacks.onConnect).toHaveBeenCalledOnce();
    sessions.sendUserMessage("why?");
    expect(conv.sendUserMessage).toHaveBeenCalledWith("why?");
  });

  it("the abandoned start landing late is ended at once, and its callbacks are dropped", async () => {
    const { sessions, calls, callbacks } = setup();
    const webrtc = sessions.start(WEBRTC);
    const ws = sessions.start(WEBSOCKET); // supersedes it, without waiting
    const wsConv = calls[1].connect();
    await ws;
    const late = calls[0].connect();
    await webrtc;
    expect(late.endSession).toHaveBeenCalledOnce();
    calls[0].cb.onError("late");
    calls[0].cb.onDisconnect({ reason: "error" });
    calls[0].cb.onMessage({ message: "hi", role: "agent" });
    expect(callbacks.onConnect).toHaveBeenCalledOnce();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onDisconnect).not.toHaveBeenCalled();
    expect(callbacks.onMessage).not.toHaveBeenCalled();
    // The websocket session is untouched.
    sessions.sendContextualUpdate("ctx");
    expect(wsConv.sendContextualUpdate).toHaveBeenCalledWith("ctx");
    expect(wsConv.endSession).not.toHaveBeenCalled();
  });

  it("a failed connect rejects; a superseded one's failure doesn't", async () => {
    const { sessions, calls } = setup();
    const first = sessions.start(WEBRTC);
    calls[0].fail(new Error("could not establish pc connection"));
    await expect(first).rejects.toThrow("could not establish pc connection");

    const stale = sessions.start(WEBRTC);
    sessions.end();
    calls[1].fail(new Error("too late"));
    await expect(stale).resolves.toBeUndefined();
  });

  it("a question can be sent from onConnect (the conversation exists by then)", async () => {
    const { sessions, calls, callbacks } = setup();
    callbacks.onConnect.mockImplementation(() =>
      sessions.sendUserMessage("queued"),
    );
    const start = sessions.start(WEBRTC);
    const conv = calls[0].connect();
    await start;
    expect(conv.sendUserMessage).toHaveBeenCalledWith("queued");
  });

  it("end() ends a live session; sending then throws, the rest is ignored", async () => {
    const { sessions, calls } = setup();
    const start = sessions.start(WEBRTC);
    const conv = calls[0].connect();
    await start;
    sessions.end();
    expect(conv.endSession).toHaveBeenCalledOnce();
    expect(() => sessions.sendUserMessage("why?")).toThrow();
    sessions.sendUserActivity();
    sessions.setMicMuted(true);
    expect(conv.sendUserActivity).not.toHaveBeenCalled();
    expect(conv.setMicMuted).not.toHaveBeenCalled();
  });

  it("a drop reaches the panel once and clears the session", async () => {
    const { sessions, calls, callbacks } = setup();
    const start = sessions.start(WEBRTC);
    calls[0].connect();
    await start;
    calls[0].cb.onDisconnect({ reason: "error" });
    expect(callbacks.onDisconnect).toHaveBeenCalledWith("error");
    expect(() => sessions.sendUserMessage("why?")).toThrow();
  });

  it("an SDK call that throws is only logged", async () => {
    const { sessions, calls, log } = setup();
    const start = sessions.start(WEBRTC);
    const conv = calls[0].connect();
    await start;
    vi.mocked(conv.sendContextualUpdate).mockImplementation(() => {
      throw new Error("socket closed");
    });
    sessions.sendContextualUpdate("ctx");
    expect(log.warn).toHaveBeenCalledWith("[qa]", expect.any(Error));
  });
});
