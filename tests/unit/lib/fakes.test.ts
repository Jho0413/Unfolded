import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTests } from "@/lib/env";
import { fakesEnabled, readFixture, readFixtureBytes } from "@/lib/fakes";

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
    for (const name of ["../env.ts", "..", "sub/x.json"])
      await expect(readFixture(name)).rejects.toThrow("bad fixture name");
  });

  it("readFixtureBytes() reads a recorded image, and only an image by its own name", async () => {
    const bytes = await readFixtureBytes("fal-cover.jpg");
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    for (const name of ["../env.ts", "x.json", "sub/x.jpg"])
      await expect(readFixtureBytes(name)).rejects.toThrow("bad fixture name");
  });
});
