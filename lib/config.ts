// Every tunable in one place (ARCHITECTURE.md section 9). No secrets here: keys live in
// lib/env.ts. Plain constants, so importing this file never reads the environment.
import "server-only";
import path from "node:path";

/** Claude effort levels we use, per request type (ARCHITECTURE.md section 5.1). */
export type Effort = "low" | "medium" | "high";

export const config = {
  /** Claude Sonnet 5.5 for the plan, every step and every sketch (ARCHITECTURE.md section 1). */
  models: {
    plan: "claude-sonnet-5-5",
    step: "claude-sonnet-5-5",
    sketch: "claude-sonnet-5-5",
  },
  /** Step: medium, chosen by spike S3 (ARCHITECTURE.md section 11). Plan and sketch are not measured yet (L1, Q4). */
  effort: {
    plan: "medium",
    step: "medium",
    sketch: "low",
  } satisfies Record<string, Effort>,
  /** Narration cap after cue markers are stripped (`narration too long`, ARCHITECTURE.md section 4). */
  maxNarrationChars: 1500,
  /** A step request (ARCHITECTURE.md sections 5.1 and 6.2). */
  step: {
    /** Output cap, thinking included. A cut-off fails the step. */
    maxTokens: 32_000,
    /**
     * Deadline for one attempt, the SDK's own retries included, until the whole streamed
     * answer is in (S3 may tune it). The SDK's `timeout` only covers waiting for headers.
     */
    timeoutMs: 180_000,
    /** Served when FAKE_APIS=1, in the Messages API's response shape. */
    fixture: "claude-step.message.json",
  },
  /** Upload cap: our own choice, not Claude's limit (ARCHITECTURE.md section 5.1). */
  maxPdfMb: 32,
  /** How long the plan route waits for the fal cover before returning without it. */
  coverTimeoutMs: 4000,
  /** Cap on `board.objects` in a POST /api/sketch body (ARCHITECTURE.md section 8). */
  maxBoardObjects: 200,
  /** fal illustrations per lesson, cover included (E1). fal credits are tight. */
  maxImagesPerLesson: 4,
  /** The Q&A agent's WebRTC conversation token (ARCHITECTURE.md section 8). */
  agentToken: {
    url: "https://api.elevenlabs.io/v1/convai/conversation/token",
    /** Ask waits on this, so a hung request gives up and Ask says Q&A is unavailable. */
    timeoutMs: 5000,
    /** How much of an ElevenLabs error body goes to the server log. */
    maxLoggedErrorChars: 500,
    /** Served when FAKE_APIS=1, in ElevenLabs' response shape. */
    fixture: "elevenlabs-conversation-token.json",
  },
  /**
   * One folder per lesson: the store and the replay set (ARCHITECTURE.md section 5.5).
   * RUNS_DIR moves it (relative to the project), so e2e never touches the real runs/.
   */
  runsDir: path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    process.env.RUNS_DIR || "runs",
  ),
  /** Recorded provider responses served when FAKE_APIS=1 (ARCHITECTURE.md section 10). */
  fixturesDir: path.join(process.cwd(), "lib", "fakes", "fixtures"),
} as const;
