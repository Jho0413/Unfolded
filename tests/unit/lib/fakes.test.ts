import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTests } from "@/lib/env";
import { fakesEnabled, readFixture } from "@/lib/fakes";

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe("lib/fakes", () => {
  it("fakesEnabled() follows FAKE_APIS=1", () => {
    vi.stubEnv("FAKE_APIS", "1");
    vi.stubEnv("REPLAY_RUN", undefined);
    expect(fakesEnabled()).toBe(true);
  });

  it("readFixture() reads a recorded fixture", async () => {
    const step = await readFixture<{ title: string }>("demo-m1.step.json");
    expect(step.title).toBe("Multiplying two matrices");
  });

  it("readFixture() rejects a path outside the fixtures folder", async () => {
    await expect(readFixture("../env.ts")).rejects.toThrow("bad fixture name");
  });
});
