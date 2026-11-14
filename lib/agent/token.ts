// The Q&A agent's session credentials (ARCHITECTURE.md section 8, step 2): a WebRTC conversation
// token, or a signed URL for the SDK's websocket fallback. The browser passes either to
// startSession(), so the API key never leaves the server. With FAKE_APIS=1 they're the recorded
// fixtures; in replay mode Q&A is off, so there are none.
import "server-only";
import { z } from "zod";
import { config } from "@/lib/config";
import { getEnv, type Env } from "@/lib/env";
import { readFixture } from "@/lib/fakes";

/** ElevenLabs' GET /v1/convai/conversation/token body, checked here where it enters. */
const TokenBody = z.object({ token: z.string().min(1) });
/** ElevenLabs' GET /v1/convai/conversation/get-signed-url body, checked here where it enters. */
const SignedUrlBody = z.object({ signed_url: z.string().min(1) });

/**
 * Why there's no token or signed URL. `unavailable`: Q&A isn't set up in this mode (no agent
 * id, or a replay run). `provider`: ElevenLabs failed. The message is for the server log, never
 * the key.
 */
export class AgentTokenError extends Error {
  override name = "AgentTokenError";
  constructor(
    readonly reason: "unavailable" | "provider",
    message: string,
  ) {
    super(message);
  }
}

/** The route's status: 503 when Q&A isn't set up here, 502 when ElevenLabs failed, else 500. */
export function tokenErrorStatus(err: unknown): number {
  if (!(err instanceof AgentTokenError)) return 500;
  return err.reason === "unavailable" ? 503 : 502;
}

/** A fresh conversation token for the agent in ELEVENLABS_AGENT_ID. Throws AgentTokenError. */
export async function getConversationToken(
  env: Env = getEnv(),
): Promise<string> {
  const body = await agentRequest(env, "token", config.agentToken, TokenBody);
  return body.token;
}

/** A fresh websocket signed URL for the agent in ELEVENLABS_AGENT_ID. Throws AgentTokenError. */
export async function getSignedUrl(env: Env = getEnv()): Promise<string> {
  const body = await agentRequest(
    env,
    "signed URL",
    config.agentSignedUrl,
    SignedUrlBody,
  );
  return body.signed_url;
}

/** Where one credential comes from: its ElevenLabs endpoint and its FAKE_APIS fixture. */
type AgentEndpoint = { url: string; fixture: string };

/** The fixture (fake mode) or ElevenLabs' reply (real mode), checked against `schema`. */
async function agentRequest<T>(
  env: Env,
  what: string,
  endpoint: AgentEndpoint,
  schema: z.ZodType<T>,
): Promise<T> {
  if (env.mode === "replay")
    throw new AgentTokenError("unavailable", "replay mode: Q&A is off");
  const body =
    env.mode === "fake"
      ? await readFixture(endpoint.fixture)
      : await requestAgent(env, what, endpoint.url);
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new AgentTokenError(
      "provider",
      `ElevenLabs ${what} response has no ${what}`,
    );
  return parsed.data;
}

async function requestAgent(
  env: Extract<Env, { mode: "real" }>,
  what: string,
  endpointUrl: string,
): Promise<unknown> {
  const agentId = env.ELEVENLABS_AGENT_ID;
  if (agentId === undefined)
    throw new AgentTokenError("unavailable", "ELEVENLABS_AGENT_ID is not set");
  const key = env.ELEVENLABS_API_KEY;
  // An error body or a fetch error might echo what we sent; the log must never hold the key.
  const redact = (text: string) => text.replaceAll(key, "[redacted]");
  // undici's message is only "fetch failed": the reason (ENOTFOUND, a timeout...) is the cause.
  const describe = (err: unknown): string =>
    redact(
      err instanceof Error
        ? `${err.name}: ${err.message}${err.cause === undefined ? "" : ` (${describe(err.cause)})`}`
        : String(err),
    );

  const url = new URL(endpointUrl);
  url.searchParams.set("agent_id", agentId);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "xi-api-key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(config.agentToken.timeoutMs),
    });
  } catch (err) {
    throw new AgentTokenError(
      "provider",
      `ElevenLabs ${what} request failed: ${describe(err)}`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AgentTokenError(
      "provider",
      `ElevenLabs ${what} request returned ${res.status}: ${redact(detail).slice(0, config.agentToken.maxLoggedErrorChars)}`,
    );
  }
  try {
    return await res.json();
  } catch (err) {
    // Also a body that stalls past the timeout.
    throw new AgentTokenError(
      "provider",
      `ElevenLabs ${what} response unreadable: ${describe(err)}`,
    );
  }
}
