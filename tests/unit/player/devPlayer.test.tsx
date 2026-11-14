// The dev-only /dev/player page and its fake lesson (ROADMAP P5): the query
// it accepts, the fake step requests, the silent audio, and that page and
// audio route are not reachable in a production server unless in fake mode
// (app/dev/devOnly.ts; the gate's modes are in tests/unit/app/dev-board-gate.test.tsx).
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as audioRoute } from "@/app/dev/player/audio/route";
import {
  FAKE_AUDIO_MS,
  FAKE_SERVER_ERROR,
  type FakeOptions,
  fakeFetchStep,
  parseFakeOptions,
} from "@/app/dev/player/fakeLesson";
import DevPlayerPage from "@/app/dev/player/page";
import { silentWav } from "@/app/dev/player/silentWav";
import { resetEnvForTests } from "@/lib/env";
import { StepResponse } from "@/shared/lesson";

// connection() resolves once a request arrives (outside Next there is none).
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

/** A production server in real mode: keys set, no fakes (lib/env.ts). */
function realMode() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("FAKE_APIS", undefined);
  vi.stubEnv("NEXT_PUBLIC_FAKE_APIS", undefined);
  vi.stubEnv("BUILT_WITH_BROWSER_FAKES", undefined);
  vi.stubEnv("REPLAY_RUN", undefined);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
  vi.stubEnv("ELEVENLABS_VOICE_ID", "test-voice");
}

/** As e2e and CI run the production build. */
function fakeMode() {
  realMode();
  vi.stubEnv("FAKE_APIS", "1");
  vi.stubEnv("BUILT_WITH_BROWSER_FAKES", "1");
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

const DEFAULTS: FakeOptions = {
  fail: "none",
  audio: "ok",
  delayMs: 0,
  debug: false,
};

describe("parseFakeOptions", () => {
  const cases: [
    string,
    Record<string, string | string[]>,
    Partial<FakeOptions>,
  ][] = [
    ["no query → the defaults", {}, {}],
    ["fail=server", { fail: "server" }, { fail: "server" }],
    ["fail=network", { fail: "network" }, { fail: "network" }],
    ["an unknown fail kind → none", { fail: "1" }, {}],
    ["audio=broken", { audio: "broken" }, { audio: "broken" }],
    ["audio=missing", { audio: "missing" }, { audio: "missing" }],
    ["an unknown audio kind → ok", { audio: "../etc" }, {}],
    ["delay=300", { delay: "300" }, { delayMs: 300 }],
    ["a negative delay → 0", { delay: "-5" }, {}],
    ["a non-number delay → 0", { delay: "soon" }, {}],
    ["a huge delay is capped", { delay: "1e9" }, { delayMs: 5000 }],
    ["debug=1", { debug: "1" }, { debug: true }],
    [
      "a repeated parameter → the first",
      { audio: ["broken", "ok"] },
      { audio: "broken" },
    ],
  ];
  it.each(cases)("%s", (_, params, expected) => {
    expect(parseFakeOptions(params)).toEqual({ ...DEFAULTS, ...expected });
  });
});

describe("fakeFetchStep", () => {
  it("returns a valid step response for each step, with the chosen audio", async () => {
    const fetchStep = fakeFetchStep({ ...DEFAULTS, audio: "broken" });
    for (const n of [0, 1]) {
      const reply = await fetchStep(n);
      if ("error" in reply) throw new Error(reply.error);
      expect(reply.step.title).toContain(`fake step ${n + 1}`);
      expect(reply.audioUrl).toBe("/dev/player/audio?kind=broken");
      // Same shape as the real route's reply, apart from the dev audio URL.
      expect(
        StepResponse.omit({ audioUrl: true }).safeParse(reply).success,
      ).toBe(true);
    }
  });
  it("fail=server: step 2's first request answers with the server's error, the retry succeeds", async () => {
    const fetchStep = fakeFetchStep({ ...DEFAULTS, fail: "server" });
    expect(await fetchStep(0)).not.toHaveProperty("error");
    expect(await fetchStep(1)).toEqual({ error: FAKE_SERVER_ERROR });
    expect(await fetchStep(1)).not.toHaveProperty("error");
  });
  it("fail=network: step 2's first request rejects, the retry succeeds", async () => {
    const fetchStep = fakeFetchStep({ ...DEFAULTS, fail: "network" });
    await expect(fetchStep(1)).rejects.toThrow("Failed to fetch");
    expect(await fetchStep(1)).not.toHaveProperty("error");
  });
});

describe("silentWav", () => {
  it("is a PCM WAV of the asked length", () => {
    const wav = silentWav(1000);
    const view = new DataView(wav.buffer);
    const ascii = (at: number) =>
      String.fromCharCode(...wav.subarray(at, at + 4));
    expect(ascii(0)).toBe("RIFF");
    expect(ascii(8)).toBe("WAVE");
    expect(ascii(36)).toBe("data");
    const sampleRate = view.getUint32(24, true);
    const dataBytes = view.getUint32(40, true);
    expect(dataBytes / sampleRate).toBe(1);
    expect(wav.length).toBe(44 + dataBytes);
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(wav.subarray(44).every((b) => b === 128)).toBe(true);
  });
});

describe("/dev/player/audio", () => {
  const get = (kind: string) =>
    audioRoute(new Request(`http://localhost/dev/player/audio?kind=${kind}`));

  it("ok: the silent track", async () => {
    const res = await get("ok");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/wav");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes).toEqual(silentWav(FAKE_AUDIO_MS));
  });
  it("broken: 200, but not audio", async () => {
    const res = await get("broken");
    expect(res.status).toBe(200);
    expect(await res.text()).not.toMatch(/^RIFF/);
  });
  it("missing: 404", async () => {
    expect((await get("missing")).status).toBe(404);
  });
  it("404s in production without FAKE_APIS", async () => {
    realMode();
    expect((await get("ok")).status).toBe(404);
  });
  it("serves in production in fake mode", async () => {
    fakeMode();
    expect((await get("ok")).status).toBe(200);
  });
});

describe("/dev/player gate", () => {
  const props = { searchParams: Promise.resolve({}) };
  it("404s in production without FAKE_APIS", async () => {
    realMode();
    await expect(DevPlayerPage(props)).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK;404/,
    );
  });
  it("renders in production with FAKE_APIS=1", async () => {
    fakeMode();
    await expect(DevPlayerPage(props)).resolves.toBeTruthy();
  });
});
