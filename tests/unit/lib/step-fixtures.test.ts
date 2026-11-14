// The recorded Step fixtures (spike S3, ARCHITECTURE.md section 11) are real Sonnet 5.5
// output: each must still pass the contract, so the fakes never serve an invalid step.
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { config } from "@/lib/config";
import { readFixture } from "@/lib/fakes";
import { validateStep } from "@/shared/validate";

const stepFixtures = readdirSync(config.fixturesDir).filter((f) =>
  f.endsWith(".step.json"),
);

describe("Step fixtures", () => {
  it("includes the S3 steps from both papers", () => {
    expect(stepFixtures.filter((f) => f.startsWith("attention-"))).toHaveLength(
      3,
    );
    expect(stepFixtures.filter((f) => f.startsWith("newton3p-"))).toHaveLength(
      3,
    );
  });

  it.each(stepFixtures)("%s passes validateStep", async (name) => {
    const result = validateStep(await readFixture(name), {
      maxNarrationChars: config.maxNarrationChars,
    });
    expect(result).toMatchObject({ ok: true });
  });
});
