// player/Whiteboard.tsx and its primitives (ROADMAP P3). The browser checks
// are in tests/e2e/board.spec.ts; these cover the pure helpers, that the dev
// page's fixed scene is a valid BoardState, and what sceneAt's output renders
// to over time (the fades of overlapping shows and hides, moved copies).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXED } from "@/app/dev/board/scenes";
import { Whiteboard } from "@/player/Whiteboard";
import { sceneAt, type TimedAction } from "@/player/sceneAt";
import {
  cellProgress,
  fadeOpacity,
  objectProgress,
} from "@/player/primitives/style";
import {
  type Action,
  type ActiveAction,
  type BoardObject,
  BoardState,
} from "@/shared/scene";

const hide = (progress: number): ActiveAction => ({
  action: { do: "hide", target: { id: "t" }, durationMs: 400 },
  progress,
});
const show = (progress: number): ActiveAction => ({
  action: { do: "show", target: { id: "t" }, durationMs: 400 },
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
    expect(fadeOpacity([show(0.3)], { id: "t" })).toBe(0.3);
  });
  it("ignores actions on other targets or parts", () => {
    expect(fadeOpacity([hide(0.5)], { id: "u" })).toBe(1);
    expect(fadeOpacity([hide(0.5)], { id: "t", row: 0 })).toBe(1);
  });
  it("a show after a hide takes the larger opacity", () => {
    expect(fadeOpacity([hide(0.75), show(0.5)], { id: "t" })).toBe(0.5);
    expect(fadeOpacity([hide(0.5), show(0.25)], { id: "t" })).toBe(0.5);
  });
  it("a hide after a show takes the smaller opacity", () => {
    expect(fadeOpacity([show(0.5), hide(0.25)], { id: "t" })).toBe(0.5);
    expect(fadeOpacity([show(0.9), hide(0.5)], { id: "t" })).toBe(0.5);
  });
});

describe("objectProgress", () => {
  const hl = (target: ActiveAction["action"]["target"], progress: number) =>
    ({
      action: { do: "highlight", target, durationMs: 300 },
      progress,
    }) satisfies ActiveAction;
  it("a highlight in progress fades the object's highlight in", () => {
    expect(
      objectProgress([hl({ id: "t" }, 0.4)], "highlight", "t", "accent"),
    ).toBe(0.4);
  });
  it("ignores other objects and parts", () => {
    expect(
      objectProgress([hl({ id: "u" }, 0.4)], "highlight", "t", "accent"),
    ).toBe(1);
    expect(
      objectProgress(
        [hl({ id: "t", row: 0 }, 0.4)],
        "highlight",
        "t",
        "accent",
      ),
    ).toBe(1);
  });
  it("doesn't borrow the progress of an overwritten highlight", () => {
    expect(
      objectProgress([hl({ id: "t" }, 0.4)], "highlight", "t", "warn"),
    ).toBe(1);
  });
  it("a write in progress fades the text in", () => {
    const write: ActiveAction = {
      action: {
        do: "write",
        target: { id: "t" },
        value: "19",
        durationMs: 300,
      },
      progress: 0.5,
    };
    expect(objectProgress([write], "write", "t", "19")).toBe(0.5);
    expect(objectProgress([write], "write", "t", "other")).toBe(1);
  });
});

describe("cellProgress", () => {
  it("a highlight in progress fades its cells in", () => {
    const hl: ActiveAction = {
      action: {
        do: "highlight",
        target: { id: "m", col: 1 },
        durationMs: 300,
      },
      progress: 0.4,
    };
    expect(cellProgress([hl], "highlight", "m", 0, 1, "accent")).toBe(0.4);
    expect(cellProgress([hl], "highlight", "m", 0, 0, "accent")).toBe(1);
    expect(cellProgress([hl], "highlight", "n", 0, 1, "accent")).toBe(1);
  });
  it("doesn't borrow the progress of an overwritten highlight", () => {
    const hl: ActiveAction = {
      action: { do: "highlight", target: { id: "m" }, durationMs: 300 },
      progress: 0.4,
    };
    // A 0 ms warn highlight since: the cell is warn, shown at once.
    expect(cellProgress([hl], "highlight", "m", 0, 0, "warn")).toBe(1);
  });
  it("with cells, only the cells the action changed fade in", () => {
    const hl: ActiveAction = {
      action: { do: "highlight", target: { id: "m" }, durationMs: 300 },
      progress: 0.4,
      cells: [[1, 0]],
    };
    expect(cellProgress([hl], "highlight", "m", 1, 0, "accent")).toBe(0.4);
    // Already accent before the action: shown at once, no blink.
    expect(cellProgress([hl], "highlight", "m", 0, 0, "accent")).toBe(1);
  });
  it("a write in progress fades its value in", () => {
    const write: ActiveAction = {
      action: {
        do: "write",
        target: { id: "m", row: 0, col: 0 },
        value: "9",
        durationMs: 300,
      },
      progress: 0.5,
    };
    expect(cellProgress([write], "write", "m", 0, 0, "9")).toBe(0.5);
    expect(cellProgress([write], "write", "m", 0, 0, "other")).toBe(1);
  });
});

describe("Whiteboard", () => {
  it("the dev page's fixed scene is a valid BoardState", () => {
    expect(() => BoardState.parse(FIXED)).not.toThrow();
  });
  const objects: BoardObject[] = [
    { kind: "matrix", id: "m", x: 100, y: 100, rows: [["1", "2"]] },
    { kind: "text", id: "t", x: 500, y: 500, text: "hi" },
    { kind: "text", id: "h", x: 700, y: 500, text: "later", hidden: true },
  ];
  const mid = (action: Action): string => {
    const timed: TimedAction[] = [{ action, startMs: 0, durationMs: 400 }];
    return renderToStaticMarkup(
      <Whiteboard state={sceneAt(objects, timed, 200)} />,
    );
  };
  /** An object's rendered opacity at each time, given [do, startMs, durationMs] fades of it. */
  const opacities = (
    id: string,
    fades: ["show" | "hide", number, number][],
    times: number[],
  ) => {
    const timed: TimedAction[] = fades.map(([action, startMs, durationMs]) => ({
      action: { do: action, target: { id }, durationMs },
      startMs,
      durationMs,
    }));
    const pattern = new RegExp(
      `data-object-id="${id}"[^>]*data-opacity="([^"]+)"`,
    );
    return times.map((tMs) =>
      Number(
        renderToStaticMarkup(
          <Whiteboard state={sceneAt(objects, timed, tMs)} />,
        ).match(pattern)?.[1],
      ),
    );
  };
  it("a show during a hide takes over with no jump: it fades in once it overtakes the hide", () => {
    // Hide 0..400, show 200..600: the hide carries on down to 0.25, then the
    // show's rising opacity overtakes it.
    expect(
      opacities(
        "t",
        [
          ["hide", 0, 400],
          ["show", 200, 400],
        ],
        [199, 200, 300, 399, 400, 600],
      ),
    ).toEqual([0.5, 0.5, 0.25, 0.5, 0.5, 1]);
  });
  it("a show that ends before the hide it interrupted leaves the object fully visible", () => {
    // Hide 0..1000, show 300..700: the hide no longer fades it after 700.
    expect(
      opacities(
        "t",
        [
          ["hide", 0, 1000],
          ["show", 300, 400],
        ],
        [299, 300, 500, 699, 700, 999, 1000],
      ),
    ).toEqual([0.7, 0.7, 0.5, 1, 1, 1, 1]);
  });
  it("a hide during a show takes over with no jump: it fades out once it overtakes the show", () => {
    // h starts hidden. Show 0..400, hide 200..600: the show carries on up to
    // 0.75, then the hide's falling opacity overtakes it.
    expect(
      opacities(
        "h",
        [
          ["show", 0, 400],
          ["hide", 200, 400],
        ],
        [199, 200, 300, 399, 400, 600],
      ),
    ).toEqual([0.5, 0.5, 0.75, 0.5, 0.5, 0]);
  });
  it("a shorter hide during a longer one fades the object out by its own end, with no jump", () => {
    // Hide 0..1000, hide 100..300: the shorter hide takes over (the min).
    expect(
      opacities(
        "t",
        [
          ["hide", 0, 1000],
          ["hide", 100, 200],
        ],
        [99, 200, 299, 300, 999],
      ),
    ).toEqual([0.9, 0.5, 0.01, 0, 0]);
  });
  it("a show of a visible object doesn't blink: it stays fully opaque", () => {
    const html = mid({ do: "show", target: { id: "t" }, durationMs: 400 });
    expect(html).toMatch(/data-object-id="t"[^>]*data-opacity="1"/);
  });
  it("a highlight over cells that already had its colour fades in only the new ones", () => {
    // Cell 0,0 is accent; then all of m goes accent: only 0,1 fades in.
    const timed: TimedAction[] = [
      {
        action: {
          do: "highlight",
          target: { id: "m", row: 0, col: 0 },
          durationMs: 0,
        },
        startMs: 0,
        durationMs: 0,
      },
      {
        action: { do: "highlight", target: { id: "m" }, durationMs: 400 },
        startMs: 100,
        durationMs: 400,
      },
    ];
    const html = renderToStaticMarkup(
      <Whiteboard state={sceneAt(objects, timed, 300)} />,
    );
    expect(html).toMatch(/data-cell="0,0"[^>]*data-highlight-opacity="1"/);
    expect(html).toMatch(/data-cell="0,1"[^>]*data-highlight-opacity="0.5"/);
  });
  it("a moved single cell renders as a one-cell copy", () => {
    const html = mid({
      do: "move",
      target: { id: "m", row: 0, col: 1 },
      to: { x: 800, y: 300 },
      durationMs: 400,
    });
    const copy = html.slice(html.indexOf('data-copy-of="m:r0c1"'));
    expect(copy).toMatch(/^data-copy-of="m:r0c1"/);
    expect(copy.match(/data-cell=/g)).toHaveLength(1);
    expect(copy).toMatch(/data-cell="0,1"[^>]*data-value="2"/);
  });
  it("renders the 1600 x 900 canvas with data attributes", () => {
    const html = renderToStaticMarkup(<Whiteboard state={FIXED} />);
    expect(html).toContain('viewBox="0 0 1600 900"');
    expect(html).toContain('data-object-id="m"');
    expect(html).toContain('data-copy-of="m:r1"');
    expect(html).toMatch(/data-cell="1,2"[^>]*data-highlight="warn"/);
  });
});

// A Q&A sketch's own layer (ARCHITECTURE.md section 8): drawn in the answer blue, with the
// lesson's layer dimmed under it (player/theme.css), only while a sketch's objects are on it.
describe("Whiteboard sketch layer", () => {
  const ids = FIXED.objects.map((s) => s.object.id);
  const layerOf = (html: string, id: string) => {
    const at = html.indexOf(`data-object-id="${id}"`);
    const sketch = html.indexOf('data-layer="sketch"');
    return sketch >= 0 && at > sketch ? "sketch" : "main";
  };

  it("no sketch ids: everything in the main layer, not sketching", () => {
    const html = renderToStaticMarkup(<Whiteboard state={FIXED} />);
    expect(html).toContain('data-sketching="false"');
    expect(html).toContain('data-layer="main"');
    expect(html).not.toContain('data-layer="sketch"');
  });

  it("an empty set (a spoken answer, or highlights only): not sketching", () => {
    const html = renderToStaticMarkup(
      <Whiteboard state={FIXED} sketchIds={new Set()} />,
    );
    expect(html).toContain('data-sketching="false"');
    expect(html).not.toContain('data-layer="sketch"');
  });

  it("a sketch's objects go in the sketch layer, the rest stay in main, and it's sketching", () => {
    const [sketched, ...rest] = ids;
    const html = renderToStaticMarkup(
      <Whiteboard state={FIXED} sketchIds={new Set([sketched])} />,
    );
    expect(html).toContain('data-sketching="true"');
    expect(layerOf(html, sketched)).toBe("sketch");
    for (const id of rest) expect(layerOf(html, id)).toBe("main");
  });

  it("ids not on the board (a fresh sketch since dropped) don't make it sketching", () => {
    const html = renderToStaticMarkup(
      <Whiteboard state={FIXED} sketchIds={new Set(["not_here"])} />,
    );
    expect(html).toContain('data-sketching="false"');
  });
});
