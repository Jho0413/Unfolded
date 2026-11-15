// app/lesson/[lessonId]/outlineRows.ts: one test per row of the outline table
// (ARCHITECTURE.md section 5.6).
import { describe, expect, it } from "vitest";
import {
  OUTLINE_LABELS,
  outlineRows,
} from "@/app/lesson/[lessonId]/outlineRows";
import type { PlayerState } from "@/player/machine";

const playing = (step: number): PlayerState => ({ kind: "playing", step });
/** No step played to its end yet. */
const none: ReadonlySet<number> = new Set();

describe("outlineRows", () => {
  it("a step played to its end: done (✓), clickable", () => {
    const [row] = outlineRows(1, playing(1), ["ready", "ready"], new Set([0]));
    expect(row).toEqual({
      place: "done",
      fetch: "ready",
      label: OUTLINE_LABELS.done,
      clickable: true,
    });
  });

  it("a step skipped past (Next mid-step, an outline jump): not done, no label", () => {
    const [row] = outlineRows(1, playing(1), ["ready", "ready"], none);
    expect(row).toEqual({
      place: "upcoming",
      fetch: "ready",
      label: null,
      clickable: true,
    });
  });

  it("a step skipped past before it was ever requested: Not ready", () => {
    const rows = outlineRows(
      2,
      playing(2),
      ["ready", "notStarted", "ready"],
      new Set([0]),
    );
    expect(rows.map((r) => [r.place, r.label])).toEqual([
      ["done", OUTLINE_LABELS.done],
      ["upcoming", OUTLINE_LABELS.notReady],
      ["current", null],
    ]);
  });

  it("a later step played to its end, then gone back from: still done", () => {
    const rows = outlineRows(
      0,
      playing(0),
      ["ready", "ready", "ready"],
      new Set([0, 1]),
    );
    expect(rows.map((r) => r.place)).toEqual(["current", "done", "upcoming"]);
  });

  it("the step on screen, even played to its end before (a replay): current", () => {
    expect(outlineRows(0, playing(0), ["ready"], new Set([0]))[0].place).toBe(
      "current",
    );
  });

  it("the step on screen: current, no label, not clickable", () => {
    const row = outlineRows(1, playing(1), ["ready", "ready"], none)[1];
    expect(row).toMatchObject({
      place: "current",
      label: null,
      clickable: false,
    });
  });

  it("a step being generated (the prefetch): Preparing", () => {
    const row = outlineRows(0, playing(0), ["ready", "generating"], none)[1];
    expect(row).toMatchObject({
      place: "upcoming",
      fetch: "generating",
      label: OUTLINE_LABELS.preparing,
      clickable: true,
    });
  });

  it("the step on screen while it loads: current, Preparing", () => {
    const row = outlineRows(
      0,
      { kind: "loading", step: 0, autoplay: true },
      ["generating"],
      none,
    )[0];
    expect(row).toMatchObject({
      place: "current",
      label: OUTLINE_LABELS.preparing,
    });
  });

  it("the step on screen loading with its reply already in (audio downloading): still Preparing", () => {
    const row = outlineRows(
      1,
      { kind: "loading", step: 1, autoplay: true },
      ["ready", "ready"],
      none,
    )[1];
    expect(row).toMatchObject({
      place: "current",
      fetch: "ready",
      label: OUTLINE_LABELS.preparing,
    });
  });

  it("an upcoming step never requested: Not ready, still clickable (it's made on arrival)", () => {
    const row = outlineRows(
      0,
      playing(0),
      ["ready", "ready", "notStarted"],
      none,
    )[2];
    expect(row).toMatchObject({
      place: "upcoming",
      label: OUTLINE_LABELS.notReady,
      clickable: true,
    });
  });

  it("an upcoming step already made: no label", () => {
    expect(
      outlineRows(0, playing(0), ["ready", "ready"], none)[1].label,
    ).toBeNull();
  });

  it("a step whose request failed: Couldn't prepare", () => {
    expect(outlineRows(0, playing(0), ["ready", "failed"], none)[1].label).toBe(
      OUTLINE_LABELS.failed,
    );
  });

  it("while asking: no row is clickable (a jump is the agent's go_to_step)", () => {
    const rows = outlineRows(
      1,
      { kind: "asking", from: { kind: "playing", step: 1 } },
      ["ready", "ready", "ready"],
      none,
    );
    expect(rows.map((r) => r.clickable)).toEqual([false, false, false]);
  });
});
