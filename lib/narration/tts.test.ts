// lib/narration/tts.ts: ElevenLabs TTS with timestamps (ARCHITECTURE.md sections 5.1, 5.2
// and 11, S1). Never calls ElevenLabs: fake mode reads the S1 fixture, and real-mode cases
// stub fetch with that recorded response.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "@/lib/config";
import type { TtsEnv } from "@/lib/narration/tts";
import { NoAlignmentError } from "@/lib/narration/cues";
import {
  TtsError,
  alignmentOf,
  narrate,
  synthesize,
} from "@/lib/narration/tts";

const fixture = JSON.parse(
  readFileSync(path.join(config.fixturesDir, config.tts.fixture), "utf8"),
);
const M1 = JSON.parse(
  readFileSync(path.join(config.fixturesDir, "demo-m1.step.json"), "utf8"),
).narration as string;

/** S1's cue times for the recorded demo-m1 response (ARCHITECTURE.md section 11). */
const M1_TIMES = {
  row: 2601,
  col: 3994,
  slide: 5213,
  pair1: 8498,
  pair2: 9787,
  add: 11146,
  total: 12318,
  drop: 14222,
  done: 16718,
};

const KEY = "sk_test_secret_key";
const real: TtsEnv = {
  mode: "real",
  ELEVENLABS_API_KEY: KEY,
  ELEVENLABS_VOICE_ID: "voice-1",
};
const fake: TtsEnv = { mode: "fake" };

function stubFetch(impl: (url: URL, init: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => vi.unstubAllGlobals());

describe("fake mode (FAKE_APIS=1)", () => {
  it("the demo-m1 narration gets the recorded response and S1's cue times", async () => {
    const fetch = stubFetch(async () => json({}));
    const out = await narrate(M1, fake);
    expect(out.cueTimes).toEqual(M1_TIMES);
    expect(Buffer.from(out.audio).toString("base64")).toBe(
      fixture.audio_base64,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("other narration gets an alignment of its own text, so cue times are exact", async () => {
    // 🙂 is one code point (one entry) but two UTF-16 units.
    const out = await narrate(
      "Look 🙂 at [[a]]this and [[b]]that.[[end]]",
      fake,
    );
    const ms = config.tts.fakeCharMs;
    expect(out.text).toBe("Look 🙂 at this and that.");
    expect(out.cueTimes).toEqual({ a: 10 * ms, b: 19 * ms, end: 24 * ms });
  });
});

describe("replay mode", () => {
  it("never makes audio", async () => {
    await expect(
      synthesize("hi", { mode: "replay", replayRun: "demo-m1" }),
    ).rejects.toMatchObject({ name: "TtsError", reason: "unavailable" });
  });
});

describe("real mode", () => {
  it("posts the text to the voice's /with-timestamps with the S1 model, and returns audio and cue times", async () => {
    const fetch = stubFetch(async () => json(fixture));
    const out = await narrate(M1, real);

    const [url, init] = fetch.mock.calls[0];
    expect(url.toString()).toBe(
      `${config.tts.url}/voice-1/with-timestamps?output_format=${config.tts.outputFormat}`,
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe(KEY);
    expect(JSON.parse(init.body as string)).toEqual({
      text: fixture.alignment.characters.join(""),
      model_id: "eleven_multilingual_v2",
    });
    expect(out.cueTimes).toEqual(M1_TIMES);
    expect(out.audio).toEqual(
      new Uint8Array(Buffer.from(fixture.audio_base64, "base64")),
    );
  });

  it("a null alignment fails the step with `no alignment`", async () => {
    stubFetch(async () => json({ ...fixture, alignment: null }));
    const err = await narrate(M1, real).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoAlignmentError);
    expect((err as Error).message).toBe("no alignment");
  });

  it("a malformed alignment counts as none", async () => {
    stubFetch(async () =>
      json({ ...fixture, alignment: { characters: "nope" } }),
    );
    expect((await synthesize("x", real)).alignment).toBeNull();
  });

  it("a body without audio is a provider error", async () => {
    stubFetch(async () => json({ alignment: fixture.alignment }));
    await expect(synthesize("x", real)).rejects.toMatchObject({
      reason: "provider",
    });
  });

  it.each([
    [429, '{"detail":{"status":"too_many_concurrent_requests"}}', "quota"],
    [401, '{"detail":{"status":"quota_exceeded"}}', "quota"],
    [401, '{"detail":{"status":"invalid_api_key"}}', "provider"],
    [500, "oops", "provider"],
  ])("HTTP %i (%s) is a %s error", async (status, body, reason) => {
    stubFetch(async () => new Response(body, { status }));
    const err = (await synthesize("x", real).catch(
      (e: unknown) => e,
    )) as TtsError;
    expect(err).toBeInstanceOf(TtsError);
    expect(err.reason).toBe(reason);
    expect(err.message).toContain(String(status));
  });

  it("never puts the key in an error message", async () => {
    stubFetch(async () => new Response(`bad key ${KEY}`, { status: 400 }));
    const a = (await synthesize("x", real).catch((e: unknown) => e)) as Error;
    stubFetch(async () => {
      throw new Error("fetch failed", { cause: new Error(`echo ${KEY}`) });
    });
    const b = (await synthesize("x", real).catch((e: unknown) => e)) as Error;
    for (const err of [a, b]) {
      expect(err).toBeInstanceOf(TtsError);
      expect(err.message).not.toContain(KEY);
      expect(err.message).toContain("[redacted]");
    }
  });
});

describe("alignmentOf (the fake's alignment)", () => {
  it("has one entry per code point, back to back", () => {
    const a = alignmentOf("a🙂b", 50);
    expect(a.characters).toEqual(["a", "🙂", "b"]);
    expect(a.character_start_times_seconds).toEqual([0, 0.05, 0.1]);
    expect(a.character_end_times_seconds).toEqual([0.05, 0.1, 0.15]);
  });
});
