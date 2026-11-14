// app/lesson/[lessonId]/outlineRows.ts: one test per row of the outline table
// (ARCHITECTURE.md section 5.6).
import { describe, expect, it } from "vitest";
import {
  OUTLINE_LABELS,
  outlineRows,
} from "@/app/lesson/[lessonId]/outlineRows";
import type { PlayerState } from "@/player/machine";

const playing = (step: number): PlayerState => ({ kind: "playing", step });

describe("outlineRows", () => {
  it("a step before the one on screen: done (✓), clickable", () => {
    const [row] = outlineRows(1, playing(1), ["ready", "ready"]);
    expect(row).toEqual({
      place: "done",
      fetch: "ready",
      label: OUTLINE_LABELS.done,
      clickable: true,
    });
  });

  it("the step on screen: current, no label, not clickable", () => {
    const row = outlineRows(1, playing(1), ["ready", "ready"])[1];
    expect(row).toMatchObject({
      place: "current",
      label: null,
      clickable: false,
    });
  });

  it("a step being generated (the prefetch): Preparing", () => {
    const row = outlineRows(0, playing(0), ["ready", "generating"])[1];
    expect(row).toMatchObject({
      place: "upcoming",
      fetch: "generating",
      label: OUTLINE_LABELS.preparing,
      clickable: true,
    });
  });

  it("the step on screen while it loads: current, Preparing", () => {
    const row = outlineRows(0, { kind: "loading", step: 0, autoplay: true }, [
      "generating",
    ])[0];
    expect(row).toMatchObject({
      place: "current",
      label: OUTLINE_LABELS.preparing,
    });
  });

  it("an upcoming step never requested: Not ready, still clickable (it's made on arrival)", () => {
    const row = outlineRows(0, playing(0), ["ready", "ready", "notStarted"])[2];
    expect(row).toMatchObject({
      place: "upcoming",
      label: OUTLINE_LABELS.notReady,
      clickable: true,
    });
  });

  it("an upcoming step already made: no label", () => {
    expect(outlineRows(0, playing(0), ["ready", "ready"])[1].label).toBeNull();
  });

  it("a step whose request failed: Couldn't prepare", () => {
    expect(outlineRows(0, playing(0), ["ready", "failed"])[1].label).toBe(
      OUTLINE_LABELS.failed,
    );
  });

  it("while asking: no row is clickable (a jump is the agent's go_to_step)", () => {
    const rows = outlineRows(
      1,
      { kind: "asking", from: { kind: "playing", step: 1 } },
      ["ready", "ready", "ready"],
    );
    expect(rows.map((r) => r.clickable)).toEqual([false, false, false]);
  });
});
