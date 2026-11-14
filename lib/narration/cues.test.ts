import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { parseNarration } from "@/shared/validate";

import {
  type Alignment,
  cueTimes,
  insertMarkers,
  NoAlignmentError,
  narrationCueTimes,
  stripMarkers,
} from "./cues";

/** An alignment of `chars`, entry i spoken from 100*i ms to 100*i + 80 ms. */
function alignmentOf(chars: string[]): Alignment {
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => i * 0.1),
    character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.08),
  };
}

/** One entry per code point, as ElevenLabs usually counts. */
const byCodePoint = (text: string) => alignmentOf([...text]);

/** Start ms of the entry for the k-th code point (alignmentOf timing). */
const at = (k: number) => Math.round(k * 0.1 * 1000);

function expectNoAlignment(fn: () => unknown) {
  expect(fn).toThrow(NoAlignmentError);
  expect(fn).toThrow("no alignment");
}

describe("cue markers become times (ARCH 5.2 table)", () => {
  it("No markers: the text unchanged, no cues", () => {
    const narration = "Take the first row of A.";
    const { text, cues } = stripMarkers(narration);
    expect(text).toBe(narration);
    expect(cues).toEqual([]);
    expect(cueTimes(text, cues, byCodePoint(text))).toEqual({});
  });

  it("A marker mid-word (ro[[c]]w): its time is the start of w", () => {
    const { text, cues } = stripMarkers("the ro[[c]]w");
    expect(text).toBe("the row");
    expect(cues).toEqual([{ cue: "c", offset: 6 }]);
    expect(cueTimes(text, cues, byCodePoint(text))).toEqual({ c: at(6) });
  });

  it("Two markers back to back: both get the same time", () => {
    const { text, cues } = stripMarkers("take [[a]][[b]]this row");
    expect(text).toBe("take this row");
    const times = cueTimes(text, cues, byCodePoint(text));
    expect(times).toEqual({ a: at(5), b: at(5) });
  });

  it("A marker at the end: the last character's end time", () => {
    const { text, cues } = stripMarkers("that is all. [[done]]  ");
    expect(text).toBe("that is all.");
    expect(cues).toEqual([{ cue: "done", offset: text.length }]);
    const alignment = byCodePoint(text);
    expect(cueTimes(text, cues, alignment)).toEqual({
      done: Math.round(alignment.character_end_times_seconds.at(-1)! * 1000),
    });
  });

  it("Unicode (é, emoji, CJK) in the narration: the walk matches characters one by one, so the cues still land correctly", () => {
    // 😀 and 𝑥 are two UTF-16 units but one code point (one alignment entry).
    const narration = "café 😀 [[a]]then 矩阵[[b]]乘法 𝑥[[c]]y";
    const { text, cues } = stripMarkers(narration);
    expect(text).toBe("café 😀 then 矩阵乘法 𝑥y");
    const points = [...text];
    const k = (s: string) => points.indexOf(s);
    const times = cueTimes(text, cues, byCodePoint(text));
    expect(times).toEqual({ a: at(k("t")), b: at(k("乘")), c: at(k("y")) });
    // By UTF-16 index the cues would land late: `c` would be read off "y"'s
    // index, which is past the end of a code-point alignment.
    expect(text.indexOf("y")).toBeGreaterThan(points.indexOf("y"));
  });

  it("Unicode (é, emoji, CJK) in the narration: entries given as UTF-16 units or graphemes also match", () => {
    const text = "é 👍🏽 ok";
    const cues = [{ cue: "x", offset: text.indexOf("ok") }];
    // UTF-16 units, lone surrogates included.
    const units = alignmentOf(text.split(""));
    expect(cueTimes(text, cues, units)).toEqual({
      x: at(text.indexOf("ok")),
    });
    // Graphemes: "é" as one decomposed entry, the skin-toned emoji as one.
    const graphemes = alignmentOf(["é", " ", "👍🏽", " ", "o", "k"]);
    expect(cueTimes(text, cues, graphemes)).toEqual({ x: at(4) });
  });

  it("Unicode (é, emoji, CJK) in the narration: an NFC/NFD difference still matches", () => {
    const text = "café [[a]]now"; // precomposed é in our text
    const stripped = stripMarkers(text);
    const decomposed = alignmentOf(["c", "a", "f", "é", " ", "n", "o"]);
    decomposed.characters.push("w");
    decomposed.character_start_times_seconds.push(0.7);
    decomposed.character_end_times_seconds.push(0.78);
    expect(cueTimes(stripped.text, stripped.cues, decomposed)).toEqual({
      a: at(5),
    });
  });

  it("The alignment skips or adds characters (normalisation): the walk resyncs on the next matching character, and the cue takes the nearest following time", () => {
    const { text, cues } = stripMarkers("one [[a]]two [[b]]three");
    expect(text).toBe("one two three");
    // Dropped "tw" (so `a` falls on "o", the nearest following time) and
    // added "-" inside "three".
    const chars = [..."one o thr-ee"];
    const alignment = alignmentOf(chars);
    expect(cueTimes(text, cues, alignment)).toEqual({
      a: at(chars.indexOf("o", 1)),
      b: at(chars.indexOf("t")),
    });
  });

  it("The alignment skips or adds characters (normalisation): an expanded entry (½ -> 1/2) is skipped and the walk carries on", () => {
    const { text, cues } = stripMarkers("add ½ [[a]]cup");
    const chars = [..."add ", "1", "/", "2", ..." cup"];
    expect(cueTimes(text, cues, alignmentOf(chars))).toEqual({
      a: at(chars.indexOf("c")),
    });
  });

  it("The alignment skips or adds characters (normalisation): resync needs a run of matches, so a spelt-out expansion doesn't pull the cue a word early", () => {
    const half = [..."one half of milk"];
    expect(narrationCueTimes("½ [[a]]of milk", alignmentOf(half))).toEqual({
      a: at(9),
    });
    const money = [..."pay five dollars now"];
    expect(narrationCueTimes("pay $5 [[a]]now", alignmentOf(money))).toEqual({
      a: at(17),
    });
  });

  it("alignment is null, or the walk can't match at all: error no alignment", () => {
    const { text, cues } = stripMarkers("hello [[a]]world");
    expectNoAlignment(() => cueTimes(text, cues, null));
    expectNoAlignment(() => cueTimes(text, cues, undefined));
    expectNoAlignment(() => cueTimes(text, cues, alignmentOf([..."XYZQ"])));
    expectNoAlignment(() => cueTimes(text, cues, alignmentOf([])));
    expectNoAlignment(() =>
      cueTimes(text, cues, {
        characters: ["h"],
        character_start_times_seconds: [0, 1],
        character_end_times_seconds: [0.1],
      }),
    );
    expectNoAlignment(() =>
      cueTimes(text, cues, {
        characters: ["h"],
        character_start_times_seconds: [Number.NaN],
        character_end_times_seconds: [0.1],
      }),
    );
  });

  it("alignment is null, or the walk can't match at all: the error carries the text and response for the log", () => {
    try {
      narrationCueTimes("hi [[a]]there", null);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(NoAlignmentError);
      expect((e as NoAlignmentError).text).toBe("hi there");
      expect((e as NoAlignmentError).alignment).toBeNull();
    }
  });
});

describe("stripMarkers", () => {
  it("trims, collapses whitespace and points cues past collapsed spaces", () => {
    const { text, cues } = stripMarkers(
      "  [[a]]Take\n\tthe  [[b]] first [[c]]",
    );
    expect(text).toBe("Take the first");
    expect(cues).toEqual([
      { cue: "a", offset: 0 },
      { cue: "b", offset: 9 },
      { cue: "c", offset: 14 },
    ]);
  });

  it("leaves malformed markers in the text, like parseNarration", () => {
    const narration = "a [[Bad]] b [[ok]]c";
    expect(stripMarkers(narration).text).toBe(parseNarration(narration).spoken);
  });

  it("keeps the first time for a duplicate cue", () => {
    const { text, cues } = stripMarkers("[[a]]one [[a]]two");
    expect(cueTimes(text, cues, byCodePoint(text))).toEqual({ a: 0 });
  });
});

// ------------------------------------------------------------ properties

const cueName = fc.stringMatching(/^[a-z][a-z0-9_]{0,31}$/);
const glyph = fc.constantFrom(
  ..."abcxyzABC.,!?'0123456789-",
  "é",
  "ß",
  "😀",
  "👍",
  "矩",
  "阵",
  "𝑥",
  "ñ",
);
const word = fc
  .array(glyph, { minLength: 1, maxLength: 6 })
  .map((g) => g.join(""));
/** Already normalised: no leading/trailing space, single spaces. */
const normalText = fc
  .array(word, { minLength: 1, maxLength: 8 })
  .map((w) => w.join(" "));

/** Normalised text plus cues at code-point boundaries, in text order. */
const textWithCues = normalText.chain((text) => {
  const boundaries = [0];
  let i = 0;
  for (const ch of text) boundaries.push((i += ch.length));
  return fc
    .array(fc.tuple(fc.constantFrom(...boundaries), cueName), { maxLength: 6 })
    .map((pairs) => ({
      text,
      cues: pairs
        .map(([offset, cue]) => ({ offset, cue }))
        .sort((a, b) => a.offset - b.offset),
    }));
});

/** Any narration: random whitespace, markers and junk around the glyphs. */
const messyNarration = fc
  .array(
    fc.oneof(
      glyph,
      fc.constantFrom(" ", "  ", "\n", "\t", "[[", "]]", "[[X]]"),
      cueName.map((c) => `[[${c}]]`),
    ),
    { maxLength: 30 },
  )
  .map((parts) => parts.join(""));

describe("properties (fast-check)", () => {
  it("stripping then reinserting the markers gives back the original text", () => {
    fc.assert(
      fc.property(textWithCues, ({ text, cues }) => {
        const narration = insertMarkers(text, cues);
        const stripped = stripMarkers(narration);
        expect(stripped.text).toBe(text);
        expect(insertMarkers(stripped.text, stripped.cues)).toBe(narration);
      }),
    );
  });

  it("the stripped text is what parseNarration says is spoken, for any narration", () => {
    fc.assert(
      fc.property(messyNarration, (narration) => {
        const { text, cues } = stripMarkers(narration);
        const parsed = parseNarration(narration);
        expect(text).toBe(parsed.spoken);
        expect(cues.map((c) => c.cue)).toEqual(parsed.cues);
        for (const c of cues) {
          expect(c.offset).toBeGreaterThanOrEqual(0);
          expect(c.offset).toBeLessThanOrEqual(text.length);
        }
        // Normalising twice changes nothing.
        expect(stripMarkers(insertMarkers(text, cues))).toEqual({ text, cues });
      }),
    );
  });

  it("cue times never decrease in text order", () => {
    // Alignment entries from the text, with some dropped and junk added.
    const edit = fc.constantFrom("keep", "keep", "keep", "drop", "add");
    fc.assert(
      fc.property(
        textWithCues,
        fc.infiniteStream(edit),
        fc.array(fc.double({ min: 0, max: 0.5, noNaN: true }), {
          minLength: 200,
          maxLength: 200,
        }),
        ({ text, cues }, edits, gaps) => {
          const chars: string[] = [];
          const it = edits[Symbol.iterator]();
          const glyphs = [...text];
          let g = 0;
          const junk = {
            next: () => ({ value: glyphs[(g += 7) % glyphs.length] }),
          };
          for (const ch of text) {
            const e = it.next().value;
            // Junk drawn from the text's own glyphs, so resyncs are ambiguous.
            if (e === "add") chars.push(junk.next().value);
            if (e !== "drop") chars.push(ch);
          }
          if (chars.length === 0) chars.push(...text);
          let t = 0;
          const startS = chars.map((_, i) => (t += gaps[i % gaps.length]));
          const alignment: Alignment = {
            characters: chars,
            character_start_times_seconds: startS,
            character_end_times_seconds: startS.map((s) => s + 0.05),
          };
          const named = cues.map((c, i) => ({ ...c, cue: `c${i}` }));
          const times = cueTimes(text, named, alignment);
          const ordered = named.map((c) => times[c.cue]);
          for (let i = 1; i < ordered.length; i++) {
            expect(ordered[i]).toBeGreaterThanOrEqual(ordered[i - 1]);
          }
        },
      ),
    );
  });

  it("walking an alignment generated from the text itself gives exact times", () => {
    fc.assert(
      fc.property(textWithCues, fc.boolean(), ({ text, cues }, units) => {
        const entries = units ? text.split("") : [...text];
        const alignment = alignmentOf(entries);
        const named = cues.map((c, i) => ({ ...c, cue: `c${i}` }));
        const times = cueTimes(text, named, alignment);

        // Expected: start of the entry beginning at the first non-space unit
        // at or after the offset, else the last entry's end.
        const entryAt = new Map<number, number>();
        let p = 0;
        entries.forEach((e, i) => {
          entryAt.set(p, i);
          p += e.length;
        });
        for (const c of named) {
          let q = c.offset;
          while (q < text.length && text[q] === " ") q++;
          const want =
            q < text.length
              ? Math.round(
                  alignment.character_start_times_seconds[entryAt.get(q)!] *
                    1000,
                )
              : Math.round(
                  alignment.character_end_times_seconds.at(-1)! * 1000,
                );
          expect(times[c.cue]).toBe(want);
        }
      }),
    );
  });
});
