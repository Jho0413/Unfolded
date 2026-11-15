// player/paper/paperAt.ts: the paper passage the narration is on (issue #98).
import { describe, expect, it } from "vitest";
import { paperRefAt } from "@/player/paper/paperAt";
import type { CuedPaperRef } from "@/shared/scene";

const refs: CuedPaperRef[] = [
  { page: 1, quote: "from the start" },
  { page: 2, quote: "at row", cue: "row" },
  { page: 3, quote: "at col", cue: "col" },
];
const cueTimes = { row: 1000, col: 2500 };

describe("paperRefAt", () => {
  it("no refs (older runs): none", () => {
    expect(paperRefAt(undefined, cueTimes, 5000)).toBeNull();
    expect(paperRefAt([], cueTimes, 5000)).toBeNull();
  });

  it("a ref with no cue is on from 0", () => {
    expect(paperRefAt(refs, cueTimes, 0)).toMatchObject({
      index: 0,
      startMs: 0,
    });
  });

  it("a cued ref starts when its word is spoken and lasts until the next", () => {
    expect(paperRefAt(refs, cueTimes, 999)?.index).toBe(0);
    expect(paperRefAt(refs, cueTimes, 1000)).toMatchObject({
      index: 1,
      startMs: 1000,
    });
    expect(paperRefAt(refs, cueTimes, 2499)?.index).toBe(1);
    expect(paperRefAt(refs, cueTimes, 9999)?.index).toBe(2);
  });

  it("before any cued ref with no start ref: none", () => {
    expect(paperRefAt(refs.slice(1), cueTimes, 500)).toBeNull();
  });

  it("a cue with no time is skipped", () => {
    expect(
      paperRefAt([{ page: 1, quote: "q", cue: "nope" }], cueTimes, 9999),
    ).toBeNull();
  });

  it("refs on the same time: the later one in the list", () => {
    const same: CuedPaperRef[] = [
      { page: 1, quote: "a", cue: "row" },
      { page: 2, quote: "b", cue: "row" },
    ];
    expect(paperRefAt(same, cueTimes, 1000)?.index).toBe(1);
  });
});
