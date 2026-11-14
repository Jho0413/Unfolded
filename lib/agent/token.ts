// The Q&A agent's WebRTC conversation token (ARCHITECTURE.md section 8, step 2): the browser
// passes it to startSession({ conversationToken }), so the API key never leaves the server.
// With FAKE_APIS=1 it's the recorded fixture; in replay mode Q&A is off, so there is none.
import "server-only";
import { z } from "zod";
import { config } from "@/lib/config";
import { getEnv, type Env } from "@/lib/env";
import { readFixture } from "@/lib/fakes";

/** ElevenLabs' GET /v1/convai/conversation/token body, checked here where it enters. */
const TokenBody = z.object({ token: z.string().min(1) });

/**
 * Why there's no token. `unavailable`: Q&A isn't set up in this mode (no agent id, or a
 * replay run). `provider`: ElevenLabs failed. The message is for the server log, never the key.
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
  if (env.mode === "replay")
    throw new AgentTokenError("unavailable", "replay mode: Q&A is off");
  const body =
    env.mode === "fake"
      ? await readFixture(config.agentToken.fixture)
      : await requestToken(env);
  const parsed = TokenBody.safeParse(body);
  if (!parsed.success)
    throw new AgentTokenError(
      "provider",
      "ElevenLabs token response has no token",
    );
  return parsed.data.token;
}

async function requestToken(
  env: Extract<Env, { mode: "real" }>,
): Promise<unknown> {
  const agentId = env.ELEVENLABS_AGENT_ID;
  if (agentId === undefined)
    throw new AgentTokenError("unavailable", "ELEVENLABS_AGENT_ID is not set");
  const key = env.ELEVENLABS_API_KEY;
  // An error body might echo what we sent; the log must never hold the key.
  const redact = (text: string) => text.replaceAll(key, "[redacted]");

  const url = new URL(config.agentToken.url);
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
      `ElevenLabs token request failed: ${redact(err instanceof Error ? err.message : String(err))}`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AgentTokenError(
      "provider",
      `ElevenLabs token request returned ${res.status}: ${redact(detail.slice(0, 500))}`,
    );
  }
  try {
    return await res.json();
  } catch {
    throw new AgentTokenError(
      "provider",
      "ElevenLabs token response is not JSON",
    );
  }
}
