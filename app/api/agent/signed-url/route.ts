// GET /api/agent/signed-url: a websocket signed URL for the Q&A agent, the Ask panel's fallback
// when its WebRTC connection can't get through (ARCHITECTURE.md sections 7 and 8). It fails like
// GET /api/agent/token: the learner gets "Questions are unavailable right now." and the developer
// the reason in the server log.
import "server-only";
import {
  AgentTokenError,
  getSignedUrl,
  tokenErrorStatus,
} from "@/lib/agent/token";
import {
  QA_UNAVAILABLE,
  type AgentSignedUrlResponse,
  type ApiError,
} from "@/shared/lesson";

// A signed URL is short-lived and opens a session: no cache may keep one.
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(): Promise<Response> {
  try {
    const signedUrl = await getSignedUrl();
    return Response.json({ signedUrl } satisfies AgentSignedUrlResponse, {
      headers: NO_STORE,
    });
  } catch (err) {
    console.error(
      "[api/agent/signed-url]",
      err instanceof AgentTokenError ? err.message : err,
    );
    return Response.json({ error: QA_UNAVAILABLE } satisfies ApiError, {
      status: tokenErrorStatus(err),
      headers: NO_STORE,
    });
  }
}
