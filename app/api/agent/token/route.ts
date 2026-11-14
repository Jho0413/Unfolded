// GET /api/agent/token: a WebRTC conversation token for the Q&A agent (ARCHITECTURE.md
// sections 7 and 8). Any failure gives the learner "Questions are unavailable right now."
// and the developer the reason in the server log.
import "server-only";
import {
  AgentTokenError,
  getConversationToken,
  tokenErrorStatus,
} from "@/lib/agent/token";
import {
  QA_UNAVAILABLE,
  type AgentTokenResponse,
  type ApiError,
} from "@/shared/lesson";

// A token is single-use and short-lived: no cache may keep one.
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(): Promise<Response> {
  try {
    const conversationToken = await getConversationToken();
    return Response.json({ conversationToken } satisfies AgentTokenResponse, {
      headers: NO_STORE,
    });
  } catch (err) {
    console.error(
      "[api/agent/token]",
      err instanceof AgentTokenError ? err.message : err,
    );
    return Response.json({ error: QA_UNAVAILABLE } satisfies ApiError, {
      status: tokenErrorStatus(err),
      headers: NO_STORE,
    });
  }
}
