// A fake Claude for step, sketch and plan generation, and the paper's upload (ARCHITECTURE.md section 10). With no script it
// answers every request with a recorded response (FAKE_APIS=1); tests pass a script of replies
// and read back the requests it got.
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { config } from "@/lib/config";
import { readFixture } from "@/lib/fakes";
import type { ClaudeFiles, ClaudeMessages } from "@/lib/pipeline/generate";

/** A reply the fake gives: a message, or an error it throws (as the SDK would). */
export type FakeReply = Anthropic.Message | Error;

export interface FakeClaude extends ClaudeMessages {
  /** Every request, in order, with its request options. */
  readonly calls: {
    body: Anthropic.MessageStreamParams;
    options?: Anthropic.RequestOptions;
  }[];
}

/**
 * Serves `replies` in order, one per request; a request past the end fails the test. Without
 * `replies`, every request gets `fixture`, a Message in the API's shape in the wire format of
 * lib/pipeline/outputFormat.ts: `config.step.fixture` (a real Sonnet 5.5 step response,
 * Attention paper, softmax over the scores with a heatmap and a plot in objectsJson, recorded
 * 2026-11-15, #103), `config.sketch.fixture`
 * (a real Sonnet 5.5 sketch) or `config.plan.fixture` (a real Sonnet 5.5 plan of the Attention
 * paper at medium effort, recorded 2026-11-14; plans have no wire format).
 */
export function fakeClaude(
  replies?: readonly FakeReply[],
  fixture: string = config.step.fixture,
): FakeClaude {
  const calls: FakeClaude["calls"] = [];
  return {
    calls,
    stream(body, options) {
      // Copied, so a test sees the request as it was sent even if the caller reuses objects.
      calls.push({ body: structuredClone(body), options });
      const i = calls.length - 1;
      return {
        async finalMessage() {
          if (replies === undefined)
            return readFixture<Anthropic.Message>(fixture);
          const reply = replies[i];
          if (reply === undefined)
            throw new Error(
              `fakeClaude: request ${i + 1}, but only ${replies.length} replies scripted`,
            );
          if (reply instanceof Error) throw reply;
          return reply;
        },
      };
    },
  };
}

/** A Message as the API returns it, with `text` as its one text block. */
export function fakeMessage(
  text: string,
  stop_reason: Anthropic.StopReason = "end_turn",
  stop_details: Anthropic.RefusalStopDetails | null = null,
): Anthropic.Message {
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    container: null,
    diagnostics: null,
    content: [{ type: "text", text, citations: null }],
    stop_reason,
    stop_sequence: null,
    stop_details,
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      inference_geo: null,
      input_tokens: 0,
      output_tokens: 0,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
      speed: null,
    },
  };
}

export interface FakeFiles extends ClaudeFiles {
  /** Every upload, in order, with its request options. */
  readonly calls: {
    params: Anthropic.FileUploadParams;
    options?: Anthropic.RequestOptions;
  }[];
}

/**
 * A fake Files API: every upload gets `reply` (an error is thrown, as the SDK would), or
 * without one the recorded upload response `fixture` (config.plan.uploadFixture).
 */
export function fakeFiles(
  reply?: Anthropic.FileMetadata | Error,
  fixture: string = config.plan.uploadFixture,
): FakeFiles {
  const calls: FakeFiles["calls"] = [];
  return {
    calls,
    async upload(params, options) {
      calls.push({ params, options });
      if (reply instanceof Error) throw reply;
      return reply ?? readFixture<Anthropic.FileMetadata>(fixture);
    },
  };
}
