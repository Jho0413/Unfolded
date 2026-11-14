import fc from "fast-check";
import { describe, expect, it } from "vitest";

describe("property smoke", () => {
  it("any string survives a JSON round trip", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (s) => {
        expect(JSON.parse(JSON.stringify(s))).toBe(s);
      }),
    );
  });
});
