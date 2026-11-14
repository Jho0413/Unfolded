// player/Whiteboard.tsx and its primitives (ROADMAP P3). The browser checks
// are in tests/e2e/board.spec.ts; these cover the pure helpers and that the
// dev page's fixed scene is a valid BoardState.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXED } from "@/app/dev/board/scenes";
import { Whiteboard } from "@/player/Whiteboard";
import {
  cellProgress,
  coversCell,
  fadeOpacity,
} from "@/player/primitives/style";
import { type ActiveAction, BoardState } from "@/shared/scene";

const hide = (progress: number): ActiveAction => ({
  action: { do: "hide", target: { id: "t" }, durationMs: 400 },
  progress,
});

describe("fadeOpacity", () => {
  it("is 1 with nothing in progress", () => {
    expect(fadeOpacity([], { id: "t" })).toBe(1);
  });
  it("fades out with a hide's progress", () => {
    expect(fadeOpacity([hide(0.25)], { id: "t" })).toBe(0.75);
  });
  it("fades in with a show's progress", () => {
    const show: ActiveAction = {
      action: { do: "show", target: { id: "t" }, durationMs: 400 },
      progress: 0.3,
    };
    expect(fadeOpacity([show], { id: "t" })).toBe(0.3);
  });
  it("ignores actions on other targets or parts", () => {
    expect(fadeOpacity([hide(0.5)], { id: "u" })).toBe(1);
    expect(fadeOpacity([hide(0.5)], { id: "t", row: 0 })).toBe(1);
  });
});

describe("coversCell and cellProgress", () => {
  it("a row covers its cells only", () => {
    expect(coversCell({ id: "m", row: 1 }, "m", 1, 0)).toBe(true);
    expect(coversCell({ id: "m", row: 1 }, "m", 0, 0)).toBe(false);
    expect(coversCell({ id: "m" }, "m", 3, 2)).toBe(true);
  });
  it("a highlight in progress fades its cells in", () => {
    const hl: ActiveAction = {
      action: {
        do: "highlight",
        target: { id: "m", col: 1 },
        durationMs: 300,
      },
      progress: 0.4,
    };
    expect(cellProgress([hl], "highlight", "m", 0, 1)).toBe(0.4);
    expect(cellProgress([hl], "highlight", "m", 0, 0)).toBe(1);
  });
});

describe("Whiteboard", () => {
  it("the dev page's fixed scene is a valid BoardState", () => {
    expect(() => BoardState.parse(FIXED)).not.toThrow();
  });
  it("renders the 1600 x 900 canvas with data attributes", () => {
    const html = renderToStaticMarkup(<Whiteboard state={FIXED} />);
    expect(html).toContain('viewBox="0 0 1600 900"');
    expect(html).toContain('data-object-id="m"');
    expect(html).toContain('data-copy-of="m:r1"');
    expect(html).toContain('data-highlight="warn"');
  });
});
