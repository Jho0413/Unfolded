// Narration audio and cue times (ARCHITECTURE.md sections 5.1 and 5.2): ElevenLabs
// POST /v1/text-to-speech/{voice_id}/with-timestamps on the narration with its markers
// stripped, then cue offsets -> times by walking the returned alignment (cues.ts).
//
// With FAKE_APIS=1 nothing is called: the demo-m1 narration gets S1's recorded response
// (its audio cut short), and any other narration gets that audio with an alignment made
// from its own text, so cue times stay exact. Replay mode never makes audio.
import "server-only";
import { z } from "zod";
import type { CueTimes } from "@/shared/lesson";
import { config } from "@/lib/config";
import { getEnv, type EnvFor } from "@/lib/env";
import { readFixture } from "@/lib/fakes";
import { cueTimes, stripMarkers, type Alignment } from "@/lib/narration/cues";

/** Every mode of Env, where real mode only needs the ElevenLabs keys. */
export type TtsEnv = EnvFor<"ELEVENLABS_API_KEY" | "ELEVENLABS_VOICE_ID">;

/**
 * TTS failed (the step fails: ARCHITECTURE.md section 6.2). `quota`: ElevenLabs refused for
 * credits or rate (401 quota_exceeded, 429). `provider`: anything else from ElevenLabs.
 * `unavailable`: this mode makes no audio (replay). The message never holds the key.
 */
export class TtsError extends Error {
  override name = "TtsError";
  constructor(
    readonly reason: "quota" | "provider" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}

/** The /with-timestamps body, checked where it enters. A malformed alignment counts as none. */
const TtsBody = z.object({
  audio_base64: z.string().min(1),
  alignment: z.unknown().optional(),
});

const AlignmentShape = z.object({
  characters: z.array(z.string()),
  character_start_times_seconds: z.array(z.number()),
  character_end_times_seconds: z.array(z.number()),
});

export interface Speech {
  /** MP3 bytes (config.tts.outputFormat). */
  audio: Uint8Array;
  /** Null when ElevenLabs sent none (never seen in S1); cueTimes then throws `no alignment`. */
  alignment: Alignment | null;
}

/** TTS with timestamps for `text` (already stripped of markers). Throws TtsError. */
export async function synthesize(
  text: string,
  env: TtsEnv = getEnv(),
): Promise<Speech> {
  if (env.mode === "replay")
    throw new TtsError("unavailable", "replay mode: no TTS");
  if (env.mode === "fake") return fakeSpeech(text);

  const body = TtsBody.safeParse(await requestSpeech(text, env));
  if (!body.success)
    throw new TtsError("provider", "ElevenLabs TTS response has no audio");
  const alignment = AlignmentShape.safeParse(body.data.alignment);
  return {
    audio: new Uint8Array(Buffer.from(body.data.audio_base64, "base64")),
    alignment: alignment.success ? alignment.data : null,
  };
}

export interface Narrated extends Speech {
  /** The text sent to TTS: the narration with markers stripped and whitespace collapsed. */
  text: string;
  /** Cue -> ms from the start of `audio`. */
  cueTimes: CueTimes;
}

/**
 * A step's narration (with [[cue]] markers) -> its audio and cue times. Throws TtsError, or
 * NoAlignmentError when the alignment is missing or doesn't match the text.
 */
export async function narrate(
  narration: string,
  env: TtsEnv = getEnv(),
): Promise<Narrated> {
  const { text, cues } = stripMarkers(narration);
  const speech = await synthesize(text, env);
  return { ...speech, text, cueTimes: cueTimes(text, cues, speech.alignment) };
}

// ---------------------------------------------------------------- real

async function requestSpeech(
  text: string,
  env: Extract<TtsEnv, { mode: "real" }>,
): Promise<unknown> {
  const key = env.ELEVENLABS_API_KEY;
  // An error body or a fetch error might echo what we sent; the log must never hold the key.
  const redact = (s: string) => s.replaceAll(key, "[redacted]");
  const describe = (err: unknown): string =>
    redact(
      err instanceof Error
        ? `${err.name}: ${err.message}${err.cause === undefined ? "" : ` (${describe(err.cause)})`}`
        : String(err),
    );

  const url = new URL(
    `${config.tts.url}/${encodeURIComponent(env.ELEVENLABS_VOICE_ID)}/with-timestamps`,
  );
  url.searchParams.set("output_format", config.tts.outputFormat);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: config.tts.modelId }),
      cache: "no-store",
      signal: AbortSignal.timeout(config.tts.timeoutMs),
    });
  } catch (err) {
    throw new TtsError(
      "provider",
      `ElevenLabs TTS request failed: ${describe(err)}`,
    );
  }
  if (!res.ok) {
    const detail = redact(await res.text().catch(() => ""));
    const quota =
      res.status === 429 ||
      (res.status === 401 && detail.includes("quota_exceeded"));
    throw new TtsError(
      quota ? "quota" : "provider",
      `ElevenLabs TTS returned ${res.status}: ${detail.slice(0, config.tts.maxLoggedErrorChars)}`,
    );
  }
  try {
    return await res.json();
  } catch (err) {
    // Also a body that stalls past the timeout.
    throw new TtsError(
      "provider",
      `ElevenLabs TTS response unreadable: ${describe(err)}`,
    );
  }
}

// ---------------------------------------------------------------- fake

interface TtsFixture {
  audio_base64: string;
  alignment: Alignment;
}

async function fakeSpeech(text: string): Promise<Speech> {
  const fixture = await readFixture<TtsFixture>(config.tts.fixture);
  const audio = new Uint8Array(Buffer.from(fixture.audio_base64, "base64"));
  if (fixture.alignment.characters.join("") === text)
    return { audio, alignment: fixture.alignment };
  return { audio, alignment: alignmentOf(text, config.tts.fakeCharMs) };
}

/** One entry per code point, like ElevenLabs (S1), each `charMs` long. */
export function alignmentOf(text: string, charMs: number): Alignment {
  const characters = Array.from(text);
  const at = (i: number) => (i * charMs) / 1000;
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => at(i)),
    character_end_times_seconds: characters.map((_, i) => at(i + 1)),
  };
}
