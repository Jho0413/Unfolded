// GET /api/agent/token (ROADMAP Q2, ARCHITECTURE.md sections 7, 8 and 9). One test per case,
// named after it. ElevenLabs is never called: FAKE_APIS=1 serves the fixture, and real-mode
// cases stub fetch.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/agent/token/route";
import {
  AgentTokenError,
  getConversationToken,
  tokenErrorStatus,
} from "@/lib/agent/token";
import { resetEnvForTests } from "@/lib/env";
import { readFixture } from "@/lib/fakes";
import { config } from "@/lib/config";
import { AgentTokenResponse, ApiError, QA_UNAVAILABLE } from "@/shared/lesson";

const KEY = "el-secret-key";
const AGENT_ID = "agent_test123";
const REAL = {
  ANTHROPIC_API_KEY: "sk-ant-test",
  ELEVENLABS_API_KEY: KEY,
  ELEVENLABS_VOICE_ID: "voice-test",
  ELEVENLABS_AGENT_ID: AGENT_ID,
};
const ENV_KEYS = [
  ...Object.keys(REAL),
  "FAL_KEY",
  "FAKE_APIS",
  "NEXT_PUBLIC_FAKE_APIS",
  "BUILT_WITH_BROWSER_FAKES",
  "REPLAY_RUN",
];

/** Runs the route against exactly these env vars (CI sets FAKE_APIS for the whole job). */
function useEnv(vars: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) vi.stubEnv(key, undefined);
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
  resetEnvForTests();
}

function stubFetch(impl: () => Promise<Response>) {
  const fetch = vi.fn(impl);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function captureErrorLog() {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  return () =>
    error.mock.calls
      .flat()
      .map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a)))
      .join(" ");
}

async function expectUnavailable(res: Response, status: number) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(ApiError.parse(await res.json())).toEqual({ error: QA_UNAVAILABLE });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetEnvForTests();
});

describe("GET /api/agent/token", () => {
  it("success with the fake: FAKE_APIS=1 returns the recorded token, ElevenLabs not called", async () => {
    useEnv({ FAKE_APIS: "1", NEXT_PUBLIC_FAKE_APIS: "1" });
    const fetch = stubFetch(async () => new Response());
    const fixture = await readFixture<{ token: string }>(
      config.agentToken.fixture,
    );

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(AgentTokenResponse.parse(await res.json())).toEqual({
      conversationToken: fixture.token,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("success for real: asks ElevenLabs with the agent id and the key in xi-api-key", async () => {
    useEnv(REAL);
    const fetch = stubFetch(async () =>
      Response.json({ token: "tok-real", conversation_id: "conv_1" }),
    );

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ conversationToken: "tok-real" });
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe(config.agentToken.url);
    expect(url.searchParams.get("agent_id")).toBe(AGENT_ID);
    expect(init.headers).toEqual({ "xi-api-key": KEY });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("missing ELEVENLABS_AGENT_ID: 503 with the unavailable message, ElevenLabs not called", async () => {
    useEnv({ ...REAL, ELEVENLABS_AGENT_ID: "" });
    const fetch = stubFetch(async () => new Response());
    const log = captureErrorLog();

    await expectUnavailable(await GET(), 503);
    expect(fetch).not.toHaveBeenCalled();
    expect(log()).toContain("ELEVENLABS_AGENT_ID is not set");
  });

  it("an ElevenLabs error: 502 with the unavailable message, the status logged, the key never logged", async () => {
    useEnv(REAL);
    stubFetch(async () =>
      Response.json(
        { detail: { status: "invalid_api_key", message: `bad key ${KEY}` } },
        { status: 401 },
      ),
    );
    const log = captureErrorLog();

    await expectUnavailable(await GET(), 502);
    expect(log()).toContain("returned 401");
    expect(log()).toContain("invalid_api_key");
    expect(log()).not.toContain(KEY);
  });

  it("an ElevenLabs error body cut for the log: the key is redacted before the cut", async () => {
    useEnv(REAL);
    stubFetch(
      async () => new Response(`${"x".repeat(495)}${KEY}`, { status: 400 }),
    );
    const log = captureErrorLog();

    await expectUnavailable(await GET(), 502);
    expect(log()).not.toContain(KEY.slice(0, 5));
  });

  it("ElevenLabs unreachable: 502 with the unavailable message, the cause logged without the key", async () => {
    useEnv(REAL);
    stubFetch(async () => {
      throw new TypeError("fetch failed", {
        cause: new Error(`getaddrinfo ENOTFOUND (sent ${KEY})`),
      });
    });
    const log = captureErrorLog();

    await expectUnavailable(await GET(), 502);
    expect(log()).toContain("ENOTFOUND");
    expect(log()).not.toContain(KEY);
  });

  it("ElevenLabs timed out: 502 with the unavailable message", async () => {
    useEnv(REAL);
    stubFetch(async () => {
      throw new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      );
    });
    const log = captureErrorLog();

    await expectUnavailable(await GET(), 502);
    expect(log()).toContain("TimeoutError");
  });

  it("ElevenLabs replies without a token: 502 with the unavailable message", async () => {
    useEnv(REAL);
    stubFetch(async () => Response.json({ conversation_id: "conv_1" }));
    captureErrorLog();

    await expectUnavailable(await GET(), 502);
  });

  it("ElevenLabs replies with something other than JSON: 502 with the unavailable message", async () => {
    useEnv(REAL);
    stubFetch(async () => new Response("<html>gateway</html>"));
    const log = captureErrorLog();

    await expectUnavailable(await GET(), 502);
    expect(log()).toContain("response unreadable");
  });

  // Called below the route: replay mode needs a runs/<id>/ folder, and loadEnv() only looks in
  // the real runs/ folder. The route's error path is the one the cases above cover.
  it("replay mode: Q&A is off, so 503 and ElevenLabs not called", async () => {
    const fetch = stubFetch(async () => new Response());

    const err = await getConversationToken({
      mode: "replay",
      replayRun: "demo-m1",
      ELEVENLABS_API_KEY: KEY,
      ELEVENLABS_AGENT_ID: AGENT_ID,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AgentTokenError);
    expect((err as AgentTokenError).reason).toBe("unavailable");
    expect(tokenErrorStatus(err)).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an unexpected error: 500", () => {
    expect(tokenErrorStatus(new Error("disk"))).toBe(500);
  });
});
