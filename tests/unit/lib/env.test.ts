// One test per row of the mode table in ARCHITECTURE.md section 9, named after the row.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { EnvError, getEnv, parseEnv, resetEnvForTests } from "@/lib/env";
import { register } from "@/instrumentation";

const REAL_KEYS = {
  ANTHROPIC_API_KEY: "sk-ant-test",
  ELEVENLABS_API_KEY: "el-test",
  ELEVENLABS_VOICE_ID: "voice-test",
};
const ALL_KEYS = [
  "ANTHROPIC_API_KEY",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
  "ELEVENLABS_AGENT_ID",
  "FAL_KEY",
  "FAKE_APIS",
  "NEXT_PUBLIC_FAKE_APIS",
  "BUILT_WITH_BROWSER_FAKES",
  "REPLAY_RUN",
];

const runsDir = mkdtempSync(path.join(tmpdir(), "env-test-runs-"));
mkdirSync(path.join(runsDir, "demo-m1"));
afterAll(() => rmSync(runsDir, { recursive: true, force: true }));

describe("Real (npm start)", () => {
  it("requires ANTHROPIC_API_KEY, ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID", () => {
    const env = parseEnv(REAL_KEYS);
    expect(env.mode).toBe("real");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
  });

  it.each(Object.keys(REAL_KEYS))(
    "a missing %s stops it, and the error names the key",
    (key) => {
      const source = { ...REAL_KEYS, [key]: undefined };
      expect(() => parseEnv(source)).toThrow(EnvError);
      expect(() => parseEnv(source)).toThrow(key);
    },
  );

  it("names every missing key at once, and treats an empty value as missing", () => {
    expect(() => parseEnv({ ANTHROPIC_API_KEY: "" })).toThrow(
      "Missing required env vars: ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID",
    );
  });

  it("does not require ELEVENLABS_AGENT_ID or FAL_KEY", () => {
    const env = parseEnv({
      ...REAL_KEYS,
      ELEVENLABS_AGENT_ID: "",
      FAL_KEY: "",
    });
    expect(env.mode).toBe("real");
    expect(env.ELEVENLABS_AGENT_ID).toBeUndefined();
    expect(env.FAL_KEY).toBeUndefined();
  });

  it("an empty REPLAY_RUN counts as unset", () => {
    expect(parseEnv({ ...REAL_KEYS, REPLAY_RUN: "" }).mode).toBe("real");
  });

  it("refuses a build made with NEXT_PUBLIC_FAKE_APIS=1", () => {
    expect(() => parseEnv(REAL_KEYS, { builtWithBrowserFakes: true })).toThrow(
      "NEXT_PUBLIC_FAKE_APIS=1",
    );
  });
});

describe("FAKE_APIS=1 (tests, CI)", () => {
  it("requires no keys", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseEnv({ FAKE_APIS: "1" }).mode).toBe("fake");
    warn.mockRestore();
  });

  it("on a build without browser fakes, starts but warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseEnv({ FAKE_APIS: "1" }).mode).toBe("fake");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("real Q&A agent"),
    );
    warn.mockRestore();
  });

  it("runs on a build made with NEXT_PUBLIC_FAKE_APIS=1", () => {
    expect(
      parseEnv({ FAKE_APIS: "1" }, { builtWithBrowserFakes: true }).mode,
    ).toBe("fake");
  });

  it('rejects a FAKE_APIS value other than "1" or "0"', () => {
    expect(() => parseEnv({ FAKE_APIS: "true" })).toThrow("FAKE_APIS");
  });

  it("trims whitespace around values", () => {
    expect(parseEnv({ FAKE_APIS: "1 " }).mode).toBe("fake");
  });

  it("FAKE_APIS=0 is real mode", () => {
    expect(() => parseEnv({ FAKE_APIS: "0" })).toThrow("ANTHROPIC_API_KEY");
  });
});

describe("REPLAY_RUN=<id>", () => {
  it("requires only that the run folder exists, no keys", () => {
    const env = parseEnv({ REPLAY_RUN: "demo-m1" }, { runsDir });
    expect(env).toMatchObject({ mode: "replay", replayRun: "demo-m1" });
  });

  it("a missing run folder stops it, naming the folder", () => {
    expect(() => parseEnv({ REPLAY_RUN: "nope" }, { runsDir })).toThrow(
      path.join(runsDir, "nope"),
    );
  });

  it("rejects an id that isn't a lesson id (no path traversal)", () => {
    expect(() => parseEnv({ REPLAY_RUN: "../etc" }, { runsDir })).toThrow(
      "REPLAY_RUN must be a lesson id",
    );
  });

  it("wins over FAKE_APIS=1", () => {
    expect(
      parseEnv({ REPLAY_RUN: "demo-m1", FAKE_APIS: "1" }, { runsDir }).mode,
    ).toBe("replay");
  });
});

function clearKeys() {
  for (const key of ALL_KEYS) vi.stubEnv(key, undefined);
}

function atServerStart() {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "phase-production-server");
}

// Throws instead of exiting, so a test sees the call and the worker survives it.
function stubExit() {
  return vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
}

describe("next build", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvForTests();
  });

  it("needs no keys: register() skips validation in the build phase", async () => {
    clearKeys();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await expect(register()).resolves.toBeUndefined();
  });
});

describe("server start (register)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetEnvForTests();
  });

  it("a missing key logs the key and exits with 1", async () => {
    clearKeys();
    atServerStart();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = stubExit();
    await expect(register()).rejects.toThrow("process.exit");
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Missing required env vars: ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID",
      ),
    );
  });

  it("a build made with NEXT_PUBLIC_FAKE_APIS=1 logs the rebuild hint and exits with 1", async () => {
    clearKeys();
    for (const [k, v] of Object.entries(REAL_KEYS)) vi.stubEnv(k, v);
    vi.stubEnv("BUILT_WITH_BROWSER_FAKES", "1");
    atServerStart();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = stubExit();
    await expect(register()).rejects.toThrow("process.exit");
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Rebuild"));
  });

  it("a valid env starts without exiting and logs the mode", async () => {
    clearKeys();
    vi.stubEnv("FAKE_APIS", "1");
    vi.stubEnv("NEXT_PUBLIC_FAKE_APIS", "1");
    atServerStart();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const exit = stubExit();
    await register();
    expect(exit).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("[env] mode: fake");
  });
});

describe("getEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvForTests();
  });

  it("validates on first use when register() hasn't run", () => {
    for (const key of ALL_KEYS) vi.stubEnv(key, undefined);
    vi.stubEnv("FAKE_APIS", "1");
    expect(getEnv().mode).toBe("fake");
  });
});
