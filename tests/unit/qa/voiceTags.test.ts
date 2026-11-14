// The Ask panel hides ElevenLabs voice tags in the agent's text (qa/voiceTags.ts).
import { describe, expect, it } from "vitest";
import { stripVoiceTags } from "@/qa/voiceTags";

describe("stripVoiceTags", () => {
  it("removes a tag between sentences", () => {
    expect(
      stripVoiceTags(
        "The scores spread out. [calm] Dividing keeps them small.",
      ),
    ).toBe("The scores spread out. Dividing keeps them small.");
  });

  it("removes tags at the start and the end, and several tags", () => {
    expect(stripVoiceTags("[warmly] Sure. [pause] Here it is. [calm]")).toBe(
      "Sure. Here it is.",
    );
  });

  it("leaves bracketed maths and other text alone", () => {
    for (const text of [
      "Take a[i] times b[i].",
      "The interval [0, 1] holds it.",
      "Call it [x] for now.",
      "See [Q K] here.",
      "Read [Vaswani2017] for more.",
      "no brackets at all",
    ])
      expect(stripVoiceTags(text), text).toBe(text);
  });
});
