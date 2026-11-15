// The Ask panel's connection (qa/connector.ts, issue #84): typed questions never wait on the
// mic, stale attempts never start a session, failures show section 7 messages, and a blocked
// WebRTC connection falls back to the websocket.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTEMPT_TIMEOUT_MS,
  LIVE_RETRY_MS,
  MAX_LIVE_RETRIES,
  AskConnector,
  CONNECTOR_MESSAGES,
  type ConnectorDeps,
  type ConnectorState,
} from "@/qa/connector";
import type { StartOptions } from "@/qa/types";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(over: Partial<ConnectorDeps> = {}) {
  const starts: StartOptions[] = [];
  const sent: string[] = [];
  const states: ConnectorState[] = [];
  const conversation = {
    start: vi.fn(async (o: StartOptions) => {
      starts.push(o);
    }),
    end: vi.fn(),
    sendUserMessage: vi.fn((t: string) => {
      sent.push(t);
    }),
  };
  const deps: ConnectorDeps = {
    conversation,
    fetchToken: vi.fn(async () => "tok"),
    fetchSignedUrl: vi.fn(async () => "wss://signed"),
    requestMicrophone: vi.fn(async () => true),
    onState: (s) => states.push(s),
    onConnected: vi.fn(),
    onDropped: vi.fn(),
    onAgentEnded: vi.fn(),
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    ...over,
  };
  const c = new AskConnector(deps);
  return { c, deps, conversation, starts, sent, states };
}

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => vi.useRealTimers());

async function settle() {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
}

describe("deciding the session (typed questions never wait on the mic)", () => {
  it("mic granted first: a voice WebRTC session", async () => {
    const { c, starts } = setup();
    c.open();
    await settle();
    expect(starts).toEqual([
      { transport: "webrtc", conversationToken: "tok", textOnly: false },
    ]);
    expect(c.current.phase).toBe("connecting");
    c.connected();
    expect(c.current).toMatchObject({
      phase: "connected",
      textOnly: false,
      transport: "webrtc",
    });
  });

  it("mic denied: text-only, with 'Mic is off…'", async () => {
    const { c, starts } = setup({ requestMicrophone: async () => false });
    c.open();
    await settle();
    expect(starts[0].textOnly).toBe(true);
    expect(c.current).toMatchObject({
      micDenied: true,
      notice: CONNECTOR_MESSAGES.micOff,
    });
  });

  it("the mic prompt is never answered: waiting, then typing starts a text-only session at once", async () => {
    const mic = deferred<boolean>();
    const { c, starts } = setup({ requestMicrophone: () => mic.promise });
    c.open();
    await settle();
    expect(c.current.phase).toBe("waiting");
    expect(starts).toEqual([]);
    c.typing();
    await settle();
    expect(starts).toEqual([
      { transport: "webrtc", conversationToken: "tok", textOnly: true },
    ]);
    // A late mic answer changes nothing.
    mic.resolve(true);
    await settle();
    expect(starts).toHaveLength(1);
    expect(c.current.textOnly).toBe(true);
    expect(c.current.notice).toBeNull();
  });

  it("a question sent before the session connects is queued and sent after the context", async () => {
    const mic = deferred<boolean>();
    const order: string[] = [];
    const { c, deps, sent } = setup({
      requestMicrophone: () => mic.promise,
      onConnected: () => order.push("context"),
    });
    (
      deps.conversation.sendUserMessage as ReturnType<typeof vi.fn>
    ).mockImplementation((t: string) => {
      order.push(t);
      sent.push(t);
    });
    c.open();
    expect(c.send("why divide by the square root of d?")).toBe(true);
    await settle();
    expect(c.current).toMatchObject({ phase: "connecting", textOnly: true });
    expect(sent).toEqual([]);
    c.connected();
    expect(order).toEqual(["context", "why divide by the square root of d?"]);
  });

  it("Use the mic switches a text-only session to voice with a new token", async () => {
    const { c, starts, conversation } = setup({
      requestMicrophone: vi.fn(async () => true),
    });
    c.open();
    c.typing();
    await settle();
    c.connected();
    expect(c.current.textOnly).toBe(true);
    await c.useMic();
    await settle();
    expect(conversation.end).toHaveBeenCalled();
    expect(starts.map((s) => s.textOnly)).toEqual([true, false]);
    c.connected();
    expect(c.current).toMatchObject({ phase: "connected", textOnly: false });
  });

  it("the token is fetched while the mic prompt is still open", async () => {
    const mic = deferred<boolean>();
    const { c, deps } = setup({ requestMicrophone: () => mic.promise });
    c.open();
    await settle();
    expect(deps.fetchToken).toHaveBeenCalledOnce();
    expect(c.current.phase).toBe("waiting");
  });

  it("useMic asks for the mic first; refused, the working session stays", async () => {
    const mic = vi.fn(async () => true);
    const { c, conversation, starts } = setup({ requestMicrophone: mic });
    c.open();
    c.typing();
    await settle();
    c.connected();
    mic.mockResolvedValueOnce(false);
    conversation.end.mockClear();
    await c.useMic();
    expect(conversation.end).not.toHaveBeenCalled();
    expect(starts).toHaveLength(1);
    expect(c.current).toMatchObject({
      phase: "connected",
      micDenied: true,
      notice: CONNECTOR_MESSAGES.micOff,
    });
  });

  it("Use the mic, and voice fails on both transports: back to a text session, with a message", async () => {
    const { c, starts } = setup();
    c.open();
    c.typing();
    await settle();
    c.connected();
    await c.useMic();
    await settle();
    c.error("voice blocked over WebRTC");
    await settle();
    c.error("voice blocked over the websocket too");
    await settle();
    expect(starts.map((s) => [s.transport, s.textOnly])).toEqual([
      ["webrtc", true],
      ["webrtc", false],
      ["websocket", false],
      ["webrtc", true],
    ]);
    expect(c.current).toMatchObject({
      phase: "connecting",
      textOnly: true,
      notice: CONNECTOR_MESSAGES.voiceFailed,
    });
    c.connected();
    expect(c.current).toMatchObject({ phase: "connected", textOnly: true });
  });

  it("a mic refused after typing decided text-only is still recorded", async () => {
    const mic = deferred<boolean>();
    const { c } = setup({ requestMicrophone: () => mic.promise });
    c.open();
    c.typing();
    await settle();
    c.connected();
    mic.resolve(false);
    await settle();
    expect(c.current.micDenied).toBe(true);
    expect(c.current.phase).toBe("connected");
  });
});

describe("no session after the panel gave up (the timeout race)", () => {
  it("closed while the token is in flight: never starts", async () => {
    const token = deferred<string | null>();
    const { c, starts } = setup({ fetchToken: () => token.promise });
    c.open();
    await settle();
    c.close();
    token.resolve("tok");
    await settle();
    expect(starts).toEqual([]);
    expect(c.current.phase).toBe("idle");
  });

  it("closed while the mic prompt is open: answering it later starts nothing", async () => {
    const mic = deferred<boolean>();
    const { c, starts } = setup({ requestMicrophone: () => mic.promise });
    c.open();
    await settle();
    c.close();
    mic.resolve(true);
    await settle();
    expect(starts).toEqual([]);
  });

  it("a connect landing after the attempts failed is ended at once", async () => {
    const { c, conversation } = setup({ fetchSignedUrl: async () => null });
    c.open();
    await settle();
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS);
    await settle();
    expect(c.current).toMatchObject({
      phase: "failed",
      notice: CONNECTOR_MESSAGES.unavailable,
    });
    conversation.end.mockClear();
    c.connected();
    expect(conversation.end).toHaveBeenCalledOnce();
    expect(c.current.phase).toBe("failed");
  });

  it("the token route fails and there's no signed URL: 'Questions are unavailable right now.'", async () => {
    const { c, starts } = setup({
      fetchToken: async () => null,
      fetchSignedUrl: async () => null,
    });
    c.open();
    await settle();
    expect(starts).toEqual([]);
    expect(c.current).toMatchObject({
      phase: "failed",
      notice: CONNECTOR_MESSAGES.unavailable,
    });
  });

  it("a hung token route still ends: the attempt timer covers the credentials", async () => {
    const { c, deps } = setup({
      fetchToken: vi.fn(() => new Promise<string | null>(() => {})),
      fetchSignedUrl: vi.fn(() => new Promise<string | null>(() => {})),
    });
    c.open();
    c.typing();
    await settle();
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS);
    await settle();
    expect(deps.fetchSignedUrl).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS);
    await settle();
    expect(c.current).toMatchObject({
      phase: "failed",
      notice: CONNECTOR_MESSAGES.unavailable,
    });
  });
});

describe("errors are shown, not swallowed", () => {
  it("a question that can't be sent: 'Q&A ended unexpectedly.', logged, the machine told", async () => {
    const { c, deps, conversation } = setup();
    c.open();
    await settle();
    c.connected();
    conversation.sendUserMessage.mockImplementation(() => {
      throw new Error("no session");
    });
    expect(c.send("why?")).toBe(false);
    expect(c.current).toMatchObject({
      phase: "idle",
      notice: CONNECTOR_MESSAGES.ended,
    });
    expect(deps.onDropped).toHaveBeenCalledOnce();
    expect(deps.log.error).toHaveBeenCalledWith(
      "[qa] couldn't send the question",
      expect.any(Error),
    );
  });

  it("a connected session drops: 'Q&A ended unexpectedly.'; the agent ends it: closed quietly", async () => {
    const a = setup();
    a.c.open();
    await settle();
    a.c.connected();
    a.c.disconnected("error");
    expect(a.c.current.notice).toBe(CONNECTOR_MESSAGES.ended);
    expect(a.deps.onDropped).toHaveBeenCalledOnce();

    const b = setup();
    b.c.open();
    await settle();
    b.c.connected();
    b.c.disconnected("agent");
    expect(b.c.current.notice).toBeNull();
    expect(b.deps.onAgentEnded).toHaveBeenCalledOnce();
  });

  it("only the drop message outlives the panel", async () => {
    const { c } = setup({ requestMicrophone: async () => false });
    c.open();
    await settle();
    c.close();
    expect(c.current.notice).toBeNull();
  });
});

describe("WebRTC blocked: the websocket fallback", () => {
  it("an error before connecting retries the same session over a websocket, kept for later", async () => {
    const { c, starts, conversation } = setup();
    c.open();
    await settle();
    c.error(
      "WebSocket connection to wss://livekit.rtc.elevenlabs.io failed: The network connection was lost.",
    );
    await settle();
    expect(starts.map((s) => s.transport)).toEqual(["webrtc", "websocket"]);
    expect(starts[1]).toEqual({
      transport: "websocket",
      signedUrl: "wss://signed",
      textOnly: false,
    });
    expect(conversation.end).toHaveBeenCalled();
    c.connected();
    expect(c.current).toMatchObject({
      phase: "connected",
      transport: "websocket",
    });
    // The next session on this page goes straight to the websocket.
    c.close();
    c.open();
    await settle();
    expect(starts.at(-1)?.transport).toBe("websocket");
  });

  it("a rejected start, a disconnect, or a timeout before connecting also falls back", async () => {
    const rejecting = setup();
    rejecting.conversation.start.mockImplementationOnce(async () => {
      throw new Error("could not establish pc connection");
    });
    rejecting.c.open();
    await settle();
    expect(rejecting.starts.map((s) => s.transport)).toEqual(["websocket"]);

    const dropped = setup();
    dropped.c.open();
    await settle();
    dropped.c.disconnected("error");
    await settle();
    expect(dropped.starts.map((s) => s.transport)).toEqual([
      "webrtc",
      "websocket",
    ]);

    const slow = setup();
    slow.c.open();
    await settle();
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS);
    await settle();
    expect(slow.starts.map((s) => s.transport)).toEqual([
      "webrtc",
      "websocket",
    ]);
  });

  it("our own end() of the abandoned attempt (a 'user' disconnect) doesn't fail the fallback", async () => {
    const { c, starts } = setup();
    c.open();
    await settle();
    c.error("blocked");
    await settle();
    c.disconnected("user");
    await settle();
    expect(starts).toHaveLength(2);
    expect(c.current.phase).toBe("connecting");
  });

  it("the websocket fails too: 'Questions are unavailable right now.', the queue dropped", async () => {
    const { c, sent } = setup();
    c.open();
    c.send("why?");
    await settle();
    c.error("blocked");
    await settle();
    c.error("websocket failed too");
    await settle();
    expect(c.current).toMatchObject({
      phase: "failed",
      notice: CONNECTOR_MESSAGES.unavailable,
    });
    c.connected();
    expect(sent).toEqual([]);
  });

  it("WebRTC hangs: at the timeout the websocket starts at once (no wait on the hung start) and connects", async () => {
    const { c, starts, conversation } = setup();
    conversation.start.mockImplementationOnce((o: StartOptions) => {
      starts.push(o);
      return new Promise<void>(() => {}); // never settles
    });
    c.open();
    await settle();
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS);
    await settle();
    expect(starts.map((s) => s.transport)).toEqual(["webrtc", "websocket"]);
    expect(conversation.end).toHaveBeenCalled();
    c.connected();
    expect(c.current).toMatchObject({
      phase: "connected",
      transport: "websocket",
    });
  });

  it("late callbacks from the abandoned WebRTC attempt don't touch the websocket attempt", async () => {
    const { c, starts, conversation } = setup({
      fetchSignedUrl: () => new Promise<string | null>(() => {}),
    });
    c.open();
    await settle();
    c.error("ICE failed");
    await settle();
    // The websocket attempt is waiting for its signed URL: no attempt owns callbacks.
    conversation.end.mockClear();
    c.connected();
    expect(conversation.end).toHaveBeenCalledOnce();
    c.error("late WebRTC error");
    c.disconnected("error");
    expect(c.current.phase).toBe("connecting");
    expect(starts.map((s) => s.transport)).toEqual(["webrtc"]);
  });

  it("with the websocket preferred, a failing websocket falls back to WebRTC", async () => {
    const { c, starts } = setup();
    c.open();
    await settle();
    c.error("blocked");
    await settle();
    c.connected(); // websocket worked: preferred from now on
    c.close();
    c.open();
    await settle();
    expect(starts.at(-1)?.transport).toBe("websocket");
    c.error("websocket blocked here");
    await settle();
    expect(starts.at(-1)?.transport).toBe("webrtc");
    c.connected();
    expect(c.current.transport).toBe("webrtc");
  });
});

describe("the lesson's voice session (issue #93)", () => {
  it("setLive(true): asks for the mic, then opens a voice session with Ask closed", async () => {
    const { c, starts, deps } = setup();
    c.setLive(true);
    await settle();
    expect(deps.requestMicrophone).toHaveBeenCalledOnce();
    expect(starts).toEqual([
      { transport: "webrtc", conversationToken: "tok", textOnly: false },
    ]);
    c.connected();
    expect(c.current).toMatchObject({
      phase: "connected",
      live: true,
      textOnly: false,
      notice: null,
    });
    expect(deps.onConnected).toHaveBeenCalledOnce();
  });

  it("mic refused: no lesson session, no message; Ask then works as before", async () => {
    const { c, starts } = setup({
      requestMicrophone: vi.fn(async () => false),
    });
    c.setLive(true);
    await settle();
    expect(starts).toEqual([]);
    expect(c.current).toMatchObject({
      phase: "idle",
      live: false,
      notice: null,
    });
    c.open();
    await settle();
    expect(starts[0].textOnly).toBe(true);
    expect(c.current.notice).toBe(CONNECTOR_MESSAGES.micOff);
  });

  it("Ask uses the lesson's session, and closing Ask keeps it", async () => {
    const { c, starts, conversation, sent } = setup();
    c.setLive(true);
    await settle();
    c.connected();
    c.open();
    await settle();
    expect(starts).toHaveLength(1);
    expect(c.send("why?")).toBe(true);
    expect(sent).toEqual(["why?"]);
    c.close();
    expect(conversation.end).not.toHaveBeenCalled();
    expect(c.current).toMatchObject({ phase: "connected", live: true });
  });

  it("a voice Ask session is kept as the lesson's when Ask closes; a text-only one is replaced", async () => {
    const voice = setup();
    voice.c.open();
    await settle();
    voice.c.connected();
    voice.c.setLive(true);
    voice.c.close();
    expect(voice.conversation.end).not.toHaveBeenCalled();
    expect(voice.c.current).toMatchObject({ phase: "connected", live: true });

    const text = setup();
    text.c.open();
    text.c.typing();
    await settle();
    text.c.connected();
    text.c.setLive(true);
    text.c.close();
    await settle();
    expect(text.conversation.end).toHaveBeenCalled();
    expect(text.starts.map((s) => s.textOnly)).toEqual([true, false]);
  });

  it("drops with Ask closed: no message, the machine isn't told, reopened after LIVE_RETRY_MS", async () => {
    const { c, starts, deps } = setup();
    c.setLive(true);
    await settle();
    c.connected();
    c.disconnected("error");
    expect(c.current).toMatchObject({
      phase: "idle",
      live: false,
      notice: null,
    });
    expect(deps.onDropped).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS);
    await settle();
    expect(starts).toHaveLength(2);
  });

  it("can't connect with Ask closed: quiet, retried MAX_LIVE_RETRIES times, then given up", async () => {
    const { c, starts } = setup({
      fetchToken: async () => null,
      fetchSignedUrl: async () => null,
    });
    c.setLive(true);
    for (let i = 0; i < MAX_LIVE_RETRIES + 2; i++) {
      await settle();
      await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS);
    }
    await settle();
    expect(starts).toEqual([]);
    expect(c.current).toMatchObject({ phase: "idle", notice: null });
    // Ask still opens its own session, and says so if it fails.
    c.open();
    await settle();
    expect(c.current.notice).toBe(CONNECTOR_MESSAGES.unavailable);
  });

  it("drops while Ask is open: 'Q&A ended unexpectedly.' as before, reopened once Ask closes", async () => {
    const { c, starts, deps } = setup();
    c.setLive(true);
    await settle();
    c.connected();
    c.open();
    c.disconnected("error");
    expect(c.current.notice).toBe(CONNECTOR_MESSAGES.ended);
    expect(deps.onDropped).toHaveBeenCalledOnce();
    c.close();
    await settle();
    expect(starts).toHaveLength(2);
    expect(c.current.live).toBe(true);
  });

  it("setLive(false) ends it with Ask closed; with Ask open, once Ask closes", async () => {
    const a = setup();
    a.c.setLive(true);
    await settle();
    a.c.connected();
    a.c.setLive(false);
    expect(a.conversation.end).toHaveBeenCalledOnce();
    expect(a.c.current).toMatchObject({ phase: "idle", live: false });

    const b = setup();
    b.c.setLive(true);
    await settle();
    b.c.connected();
    b.c.open();
    b.c.setLive(false);
    expect(b.conversation.end).not.toHaveBeenCalled();
    b.c.close();
    expect(b.conversation.end).toHaveBeenCalledOnce();
    expect(b.c.current.phase).toBe("idle");
  });

  it("Ask opened while the lesson's mic prompt is open: Ask's own session, as before", async () => {
    const mic = deferred<boolean>();
    const { c, starts } = setup({ requestMicrophone: () => mic.promise });
    c.setLive(true);
    await settle();
    c.open();
    c.typing();
    await settle();
    expect(starts).toEqual([
      { transport: "webrtc", conversationToken: "tok", textOnly: true },
    ]);
    mic.resolve(true);
    await settle();
    expect(starts).toHaveLength(1);
  });
});

describe("cutting the agent off (issue #93)", () => {
  it("interruptLive reopens the lesson's session with Ask closed; it does nothing with Ask open or no session", async () => {
    const { c, starts, conversation } = setup();
    c.interruptLive();
    expect(conversation.end).not.toHaveBeenCalled();
    c.setLive(true);
    await settle();
    c.connected();
    c.open();
    c.interruptLive();
    expect(conversation.end).not.toHaveBeenCalled();
    c.close();
    c.interruptLive();
    expect(conversation.end).toHaveBeenCalledOnce();
    await settle();
    expect(starts).toHaveLength(2);
    expect(c.current).toMatchObject({ phase: "connecting", live: true });
  });
});
