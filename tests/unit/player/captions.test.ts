// player/captions.ts (ARCHITECTURE.md section 5.3, the captions input table): one test per
// row, plus properties over random narrations.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { captionAt, sentencesOf } from "@/player/captions";
import { stripMarkers } from "@/lib/narration/cues";

const said = (c: ReturnType<typeof captionAt>) =>
  c === null ? null : c.text.slice(0, c.spoken);
const now = (c: ReturnType<typeof captionAt>) =>
  c === null ? null : c.text.slice(c.spoken, c.current);

describe("captionAt", () => {
  it("empty narration (or only markers and spaces): no caption", () => {
    expect(captionAt("", {}, 1000, 0)).toBeNull();
    expect(captionAt("  [[a]]  ", { a: 0 }, 1000, 500)).toBeNull();
  });

  it("no cues: interpolates from 0 s to the end of the audio", () => {
    // "One two. Three four." is 20 characters over 2 s: 100 ms a character.
    const n = "One two. Three four.";
    expect(captionAt(n, {}, 2000, 0)).toEqual({
      index: 0,
      text: "One two.",
      spoken: 0,
      current: 3,
    });
    // 500 ms: offset 5, inside "two.".
    const mid = captionAt(n, {}, 2000, 500);
    expect(said(mid)).toBe("One ");
    expect(now(mid)).toBe("two.");
    // 1000 ms: offset 10, inside "Three".
    const second = captionAt(n, {}, 2000, 1000);
    expect(second?.index).toBe(1);
    expect(second?.text).toBe("Three four.");
    expect(now(second)).toBe("Three");
  });

  it("no cues and no duration yet: the first sentence, nothing said", () => {
    const c = captionAt("One two. Three four.", {}, null, 5000);
    expect(c?.index).toBe(0);
    expect(c?.spoken).toBe(0);
    expect(captionAt("One two. Three.", {}, Number.NaN, 5000)?.index).toBe(0);
  });

  it("one cue: interpolates before and after it", () => {
    // Text "Take the row. Then the column." The cue sits at "Then" (offset 14) at 1000 ms.
    const n = "Take the row. [[col]]Then the column.";
    expect(stripMarkers(n).cues).toEqual([{ cue: "col", offset: 14 }]);
    // 500 ms: halfway to offset 14 -> offset 7, inside "the".
    const before = captionAt(n, { col: 1000 }, 3000, 500);
    expect(before?.index).toBe(0);
    expect(now(before)).toBe("the");
    // At the cue: the second sentence's first word.
    const at = captionAt(n, { col: 1000 }, 3000, 1000);
    expect(at?.index).toBe(1);
    expect(said(at)).toBe("");
    expect(now(at)).toBe("Then");
  });

  it("a cue at the start of a sentence: that sentence shows from the cue's time", () => {
    const n = "First idea here. [[two]]Second idea.";
    expect(captionAt(n, { two: 4000 }, 6000, 3999)?.index).toBe(0);
    expect(captionAt(n, { two: 4000 }, 6000, 4000)?.index).toBe(1);
  });

  it("t before the first cue (and before 0): the first sentence", () => {
    const n = "Alpha beta. [[b]]Gamma.";
    expect(captionAt(n, { b: 2000 }, 3000, 0)?.index).toBe(0);
    expect(captionAt(n, { b: 2000 }, 3000, -50)).toEqual({
      index: 0,
      text: "Alpha beta.",
      spoken: 0,
      current: 5,
    });
  });

  it("t past the end: the last sentence, all said", () => {
    const n = "Alpha beta. Gamma delta.";
    const c = captionAt(n, {}, 1000, 99_999);
    expect(c).toEqual({
      index: 1,
      text: "Gamma delta.",
      spoken: 12,
      current: 12,
    });
  });

  it("between two words: the earlier one is said, none is current", () => {
    // "ab cd." over 600 ms: 100 ms a character; 200 ms is the space.
    const c = captionAt("ab cd.", {}, 600, 200);
    expect(said(c)).toBe("ab");
    expect(c?.spoken).toBe(c?.current);
  });

  it("a cue the times don't list is skipped; one timed past the end is capped", () => {
    const n = "One [[x]]two. [[y]]Three.";
    expect(captionAt(n, {}, 1000, 0)?.index).toBe(0);
    // y at 5 s is capped to the 1 s duration: at 1 s the text has ended.
    expect(captionAt(n, { y: 5000 }, 1000, 1000)?.index).toBe(1);
  });

  it("Unicode (accents, emoji, CJK): sentences stay whole and words never split", () => {
    const n = "Café au lait 🍵 ici. 注意力很重要。[[z]]Done.";
    const c = captionAt(n, { z: 1000 }, 2000, 500);
    expect(sentencesOf(stripMarkers(n).text).map((s) => s.text)).toContain(
      c?.text,
    );
    for (let t = 0; t <= 2000; t += 37) {
      const at = captionAt(n, { z: 1000 }, 2000, t);
      if (at === null) throw new Error("no caption");
      // No lone surrogate at a split.
      for (const part of [said(at), now(at)])
        expect(part).toBe(part?.normalize());
      expect(/[\uD800-\uDBFF]$/.test(said(at) ?? "")).toBe(false);
    }
  });
});

// Narrations: words, sometimes ending a sentence, sometimes preceded by a cue marker.
const narration = fc
  .array(
    fc.record({
      word: fc.constantFrom("row", "Column", "café", "🍵", "注意力", "x", "a1"),
      end: fc.boolean(),
      cue: fc.boolean(),
    }),
    { minLength: 1, maxLength: 20 },
  )
  .map((words) => {
    const times: Record<string, number> = {};
    const parts = words.map((w, i) => {
      const marker = w.cue ? `[[c${i}]]` : "";
      if (w.cue) times[`c${i}`] = i * 300;
      return `${marker}${w.word}${w.end ? "." : ""}`;
    });
    return { text: parts.join(" "), times, duration: words.length * 300 + 300 };
  });

describe("captionAt properties", () => {
  it("the sentence index never decreases as t grows, and the text is always a sentence of the narration", () => {
    fc.assert(
      fc.property(
        narration,
        fc.array(fc.integer({ min: -1000, max: 10_000 }), {
          minLength: 2,
          maxLength: 30,
        }),
        ({ text, times, duration }, ts) => {
          const sentences = sentencesOf(stripMarkers(text).text).map(
            (s) => s.text,
          );
          let last = -1;
          for (const t of [...ts].sort((a, b) => a - b)) {
            const c = captionAt(text, times, duration, t);
            if (c === null) throw new Error("no caption");
            expect(c.index).toBeGreaterThanOrEqual(last);
            last = c.index;
            expect(sentences[c.index]).toBe(c.text);
            expect(0 <= c.spoken && c.spoken <= c.current).toBe(true);
            expect(c.current).toBeLessThanOrEqual(c.text.length);
          }
        },
      ),
    );
  });
});
