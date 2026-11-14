// player/sceneAt.ts (ARCHITECTURE.md section 5.3, ROADMAP P2).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import demoM1 from "@/lib/fakes/fixtures/demo-m1.step.json";
import { narrationCueTimes } from "@/lib/narration/cues";
import {
  type Action,
  type BoardObject,
  BoardState,
  cellCentre,
  Step,
} from "@/shared/scene";
import { validateStep } from "@/shared/validate";
import {
  coversCell,
  resolveAnchor,
  sceneAt,
  type TimedAction,
  timeline,
} from "@/player/sceneAt";

// ---------------------------------------------------------------- helpers

/** m: 2 x 2 matrix at (100, 100); t: text at (500, 500); h: hidden text. */
function board(): BoardObject[] {
  return [
    {
      kind: "matrix",
      id: "m",
      x: 100,
      y: 100,
      rows: [
        ["1", "2"],
        ["3", "4"],
      ],
    },
    { kind: "text", id: "t", x: 500, y: 500, text: "hi" },
    { kind: "text", id: "h", x: 700, y: 500, text: "later", hidden: true },
  ];
}

/** An action with an optional duration (default 400 ms). */
type ActionInput = Action extends infer A
  ? A extends Action
    ? Omit<A, "durationMs"> & { durationMs?: number }
    : never
  : never;

function at(startMs: number, action: ActionInput): TimedAction {
  const durationMs = action.durationMs ?? 400;
  return { action: { ...action, durationMs } as Action, startMs, durationMs };
}

function obj(state: BoardState, id: string) {
  const s = state.objects.find((o) => o.object.id === id);
  if (!s) throw new Error(`no object ${id}`);
  return s;
}

function copy(state: BoardState, id: string, row?: number, col?: number) {
  return state.copies.find(
    (c) => c.source.id === id && c.source.row === row && c.source.col === col,
  );
}

// ---------------------------------------------------------------- times

describe("sceneAt: times", () => {
  const timed = [
    at(1000, { do: "highlight", target: { id: "t" } }),
    at(2000, { do: "move", target: { id: "t" }, to: { x: 900, y: 500 } }),
  ];

  it("before the first cue: the starting board, nothing active", () => {
    const s = sceneAt(board(), timed, 999);
    expect(obj(s, "t").highlight).toBeNull();
    expect(obj(s, "t").object).toMatchObject({ x: 500, y: 500 });
    expect(obj(s, "h").visible).toBe(false);
    expect(s.active).toEqual([]);
    expect(s.copies).toEqual([]);
  });

  it("exactly at a cue: the action has started, progress 0", () => {
    const s = sceneAt(board(), timed, 1000);
    expect(obj(s, "t").highlight).toBe("accent");
    expect(s.active).toEqual([{ action: timed[0].action, progress: 0 }]);
    const m = sceneAt(board(), timed, 2000);
    expect(obj(m, "t").object).toMatchObject({ x: 500, y: 500 });
  });

  it("mid-animation: a move is part way, with its progress", () => {
    const s = sceneAt(board(), timed, 2100);
    expect(obj(s, "t").object).toMatchObject({ x: 600, y: 500 });
    expect(s.active).toEqual([{ action: timed[1].action, progress: 0.25 }]);
  });

  it("after the end: every action complete, nothing active", () => {
    const s = sceneAt(board(), timed, 10_000);
    expect(obj(s, "t").object).toMatchObject({ x: 900, y: 500 });
    expect(obj(s, "t").highlight).toBe("accent");
    expect(s.active).toEqual([]);
  });

  it("an action ends at exactly start + duration: progress 1, no longer active", () => {
    const s = sceneAt(board(), timed, 2400);
    expect(obj(s, "t").object).toMatchObject({ x: 900, y: 500 });
    expect(s.active).toEqual([]);
  });

  it("a zero-duration action is complete at its start and never active", () => {
    const s = sceneAt(
      board(),
      [at(100, { do: "hide", target: { id: "t" }, durationMs: 0 })],
      100,
    );
    expect(obj(s, "t").visible).toBe(false);
    expect(s.active).toEqual([]);
  });

  it("seeking backwards gives the same state as playing forwards", () => {
    const step = Step.parse(demoM1);
    const timedDemo = timeline(step.actions, demoCueTimes);
    const forwards = new Map<number, BoardState>();
    for (let t = 0; t <= 9000; t += 50)
      forwards.set(t, sceneAt(step.objects, timedDemo, t));
    sceneAt(step.objects, timedDemo, 9000); // at the end
    for (let t = 9000; t >= 0; t -= 50)
      expect(sceneAt(step.objects, timedDemo, t)).toEqual(forwards.get(t));
  });

  it("actions are applied in start order, whatever their array order", () => {
    const s = sceneAt(
      board(),
      [
        at(200, { do: "write", target: { id: "t" }, value: "second" }),
        at(100, { do: "write", target: { id: "t" }, value: "first" }),
      ],
      300,
    );
    expect(obj(s, "t").object).toMatchObject({ text: "second" });
  });

  it("simultaneous actions apply in array order", () => {
    const s = sceneAt(
      board(),
      [
        at(100, { do: "write", target: { id: "t" }, value: "a" }),
        at(100, { do: "write", target: { id: "t" }, value: "b" }),
      ],
      100,
    );
    expect(obj(s, "t").object).toMatchObject({ text: "b" });
  });
});

// ---------------------------------------------------------------- visibility

describe("sceneAt: visibility", () => {
  it("a hidden object appears only after its show", () => {
    const timed = [at(1000, { do: "show", target: { id: "h" } })];
    expect(obj(sceneAt(board(), timed, 999), "h").visible).toBe(false);
    expect(obj(sceneAt(board(), timed, 1000), "h").visible).toBe(true);
    expect(obj(sceneAt(board(), timed, 5000), "h").visible).toBe(true);
  });

  it("hide keeps the object visible until it ends (so it can fade out)", () => {
    const timed = [at(1000, { do: "hide", target: { id: "t" } })];
    expect(obj(sceneAt(board(), timed, 1200), "t").visible).toBe(true);
    expect(obj(sceneAt(board(), timed, 1400), "t").visible).toBe(false);
  });

  it("show on a visible object and hide on a hidden one change nothing", () => {
    const s = sceneAt(
      board(),
      [
        at(0, { do: "show", target: { id: "t" }, durationMs: 0 }),
        at(0, { do: "hide", target: { id: "h" }, durationMs: 0 }),
      ],
      10,
    );
    expect(obj(s, "t").visible).toBe(true);
    expect(obj(s, "h").visible).toBe(false);
  });

  it("hide on a part that hasn't moved changes nothing", () => {
    const s = sceneAt(
      board(),
      [at(0, { do: "hide", target: { id: "m", row: 0 }, durationMs: 0 })],
      10,
    );
    expect(obj(s, "m").visible).toBe(true);
    expect(s.copies).toEqual([]);
  });

  it("hide on a moved part removes its copy and leaves the matrix", () => {
    const s = sceneAt(
      board(),
      [
        at(0, {
          do: "move",
          target: { id: "m", row: 0 },
          to: { x: 800, y: 300 },
        }),
        at(1000, { do: "hide", target: { id: "m", row: 0 } }),
      ],
      2000,
    );
    expect(copy(s, "m", 0)).toBeUndefined();
    expect(s.copies).toEqual([]);
    expect(obj(s, "m").visible).toBe(true);
  });
});

// ---------------------------------------------------------------- highlight

describe("sceneAt: highlight", () => {
  it("a row, a column and a cell highlight their cells", () => {
    const row = sceneAt(
      board(),
      [at(0, { do: "highlight", target: { id: "m", row: 1 } })],
      1,
    );
    expect(obj(row, "m").cellHighlight).toEqual([
      [null, null],
      ["accent", "accent"],
    ]);
    const col = sceneAt(
      board(),
      [at(0, { do: "highlight", target: { id: "m", col: 0 }, color: "warn" })],
      1,
    );
    expect(obj(col, "m").cellHighlight).toEqual([
      ["warn", null],
      ["warn", null],
    ]);
    const cell = sceneAt(
      board(),
      [at(0, { do: "highlight", target: { id: "m", row: 0, col: 1 } })],
      1,
    );
    expect(obj(cell, "m").cellHighlight).toEqual([
      [null, "accent"],
      [null, null],
    ]);
  });

  it("a whole matrix highlights every cell; the object highlight stays null", () => {
    const s = sceneAt(
      board(),
      [at(0, { do: "highlight", target: { id: "m" } })],
      1,
    );
    expect(obj(s, "m").cellHighlight).toEqual([
      ["accent", "accent"],
      ["accent", "accent"],
    ]);
    expect(obj(s, "m").highlight).toBeNull();
  });

  it("a non-matrix object gets a whole-object highlight", () => {
    const s = sceneAt(
      board(),
      [at(0, { do: "highlight", target: { id: "t" }, color: "warn" })],
      1,
    );
    expect(obj(s, "t").highlight).toBe("warn");
    expect(obj(s, "t").cellHighlight).toBeUndefined();
  });

  it("unhighlight clears; with a colour it clears only that colour", () => {
    const base = [
      at(0, { do: "highlight", target: { id: "m", row: 0 }, color: "warn" }),
      at(0, { do: "highlight", target: { id: "m", row: 1 } }),
    ];
    const some = sceneAt(
      board(),
      [
        ...base,
        at(10, { do: "unhighlight", target: { id: "m" }, color: "warn" }),
      ],
      20,
    );
    expect(obj(some, "m").cellHighlight).toEqual([
      [null, null],
      ["accent", "accent"],
    ]);
    const all = sceneAt(
      board(),
      [...base, at(10, { do: "unhighlight", target: { id: "m" } })],
      20,
    );
    expect(obj(all, "m").cellHighlight).toEqual([
      [null, null],
      [null, null],
    ]);
  });
});

describe("coversCell", () => {
  it("a whole matrix covers every cell", () => {
    expect(coversCell({ id: "m" }, 3, 2)).toBe(true);
  });
  it("a row covers its cells only", () => {
    expect(coversCell({ id: "m", row: 1 }, 1, 0)).toBe(true);
    expect(coversCell({ id: "m", row: 1 }, 0, 0)).toBe(false);
  });
  it("a cell covers itself only", () => {
    expect(coversCell({ id: "m", row: 0, col: 1 }, 0, 1)).toBe(true);
    expect(coversCell({ id: "m", row: 0, col: 1 }, 0, 0)).toBe(false);
    expect(coversCell({ id: "m", row: 0, col: 1 }, 1, 1)).toBe(false);
  });
});

// ---------------------------------------------------------------- move

describe("sceneAt: move", () => {
  it("moving a row slides a copy and leaves the matrix whole", () => {
    const timed = [
      at(0, {
        do: "move",
        target: { id: "m", row: 0 },
        to: { x: 800, y: 300 },
      }),
    ];
    const start = cellCentre(100, 100, 0, 0);
    const rowCentre = { x: start.x + 32, y: start.y }; // middle of 2 cells
    const mid = sceneAt(board(), timed, 200);
    expect(copy(mid, "m", 0)).toEqual({
      source: { id: "m", row: 0 },
      x: (rowCentre.x + 800) / 2,
      y: (rowCentre.y + 300) / 2,
      visible: true,
    });
    const end = sceneAt(board(), timed, 400);
    expect(copy(end, "m", 0)).toMatchObject({ x: 800, y: 300 });
    expect(obj(end, "m").object).toEqual(board()[0]);
    expect(obj(end, "m").visible).toBe(true);
  });

  it("moving a single cell slides a copy of that cell", () => {
    const timed = [
      at(0, {
        do: "move",
        target: { id: "m", row: 0, col: 1 },
        to: { x: 800, y: 300 },
      }),
    ];
    const start = cellCentre(100, 100, 0, 1);
    const mid = sceneAt(board(), timed, 200);
    expect(mid.copies).toEqual([
      {
        source: { id: "m", row: 0, col: 1 },
        x: (start.x + 800) / 2,
        y: (start.y + 300) / 2,
        visible: true,
      },
    ]);
    const end = sceneAt(board(), timed, 400);
    expect(copy(end, "m", 0, 1)).toMatchObject({ x: 800, y: 300 });
    expect(copy(end, "m", 0)).toBeUndefined();
    expect(obj(end, "m").object).toEqual(board()[0]);
    expect(resolveAnchor(end, { id: "m", row: 0, col: 1 })).toEqual({
      x: 800,
      y: 300,
    });
  });

  it("a later highlight of a moved row changes both (the copy reads the source cells)", () => {
    const s = sceneAt(
      board(),
      [
        at(0, {
          do: "move",
          target: { id: "m", row: 0 },
          to: { x: 800, y: 300 },
        }),
        at(1000, { do: "highlight", target: { id: "m", row: 0 } }),
      ],
      1100,
    );
    expect(obj(s, "m").cellHighlight?.[0]).toEqual(["accent", "accent"]);
    expect(copy(s, "m", 0)?.source).toEqual({ id: "m", row: 0 });
  });

  it("a move to a cell anchor ends on that cell's centre", () => {
    const s = sceneAt(
      board(),
      [
        at(0, {
          do: "move",
          target: { id: "t" },
          to: { id: "m", row: 1, col: 1 },
        }),
      ],
      400,
    );
    expect(obj(s, "t").object).toMatchObject(cellCentre(100, 100, 1, 1));
  });

  it("anchors: a whole matrix's centre, a column's centre, another object", () => {
    const toMatrix = sceneAt(
      board(),
      [
        at(0, {
          do: "move",
          target: { id: "t" },
          to: { id: "m" },
          durationMs: 0,
        }),
      ],
      0,
    );
    expect(obj(toMatrix, "t").object).toMatchObject({ x: 164, y: 148 });
    const toCol = sceneAt(
      board(),
      [
        at(0, {
          do: "move",
          target: { id: "t" },
          to: { id: "m", col: 1 },
          durationMs: 0,
        }),
      ],
      0,
    );
    expect(obj(toCol, "t").object).toMatchObject({ x: 196, y: 148 });
    const toText = sceneAt(
      board(),
      [
        at(0, {
          do: "move",
          target: { id: "m" },
          to: { id: "t" },
          durationMs: 0,
        }),
      ],
      0,
    );
    // The matrix's centre lands on t: its top-left is half its box away.
    expect(obj(toText, "m").object).toMatchObject({ x: 436, y: 452 });
  });

  it("an anchor naming a moved part uses its copy", () => {
    const s = sceneAt(
      board(),
      [
        at(0, {
          do: "move",
          target: { id: "m", col: 0 },
          to: { x: 900, y: 600 },
          durationMs: 0,
        }),
        at(10, {
          do: "move",
          target: { id: "t" },
          to: { id: "m", col: 0 },
          durationMs: 0,
        }),
      ],
      10,
    );
    expect(obj(s, "t").object).toMatchObject({ x: 900, y: 600 });
  });

  it("a second move of a part moves the same copy from where it is", () => {
    const timed = [
      at(0, {
        do: "move",
        target: { id: "m", row: 0, col: 0 },
        to: { x: 300, y: 300 },
      }),
      at(1000, {
        do: "move",
        target: { id: "m", row: 0, col: 0 },
        to: { x: 500, y: 300 },
      }),
    ];
    const s = sceneAt(board(), timed, 1200);
    expect(s.copies).toHaveLength(1);
    expect(copy(s, "m", 0, 0)).toMatchObject({ x: 400, y: 300 });
  });

  it("after a hide, the part anchors to its source again and a new move makes a fresh copy", () => {
    const timed = [
      at(0, {
        do: "move",
        target: { id: "m", row: 0 },
        to: { x: 800, y: 300 },
        durationMs: 0,
      }),
      at(100, { do: "hide", target: { id: "m", row: 0 }, durationMs: 0 }),
      at(200, {
        do: "move",
        target: { id: "t" },
        to: { id: "m", row: 0 },
        durationMs: 0,
      }),
      at(300, {
        do: "move",
        target: { id: "m", row: 0 },
        to: { x: 300, y: 600 },
      }),
    ];
    const anchored = sceneAt(board(), timed, 250);
    expect(anchored.copies).toEqual([]);
    expect(obj(anchored, "t").object).toMatchObject({ x: 164, y: 124 });
    const moving = sceneAt(board(), timed, 500);
    expect(moving.copies).toEqual([
      {
        source: { id: "m", row: 0 },
        x: (164 + 300) / 2,
        y: (124 + 600) / 2,
        visible: true,
      },
    ]);
  });

  it("moving a whole object moves the object itself, not a copy", () => {
    const s = sceneAt(
      board(),
      [
        at(0, {
          do: "move",
          target: { id: "m" },
          to: { x: 800, y: 400 },
          durationMs: 0,
        }),
      ],
      0,
    );
    expect(s.copies).toEqual([]);
    expect(obj(s, "m").object).toMatchObject({ x: 736, y: 352 });
  });

  it("an arrow can't move, and follows the objects it names", () => {
    const objects: BoardObject[] = [
      ...board(),
      { kind: "arrow", id: "r", from: { id: "t" }, to: { x: 0, y: 0 } },
    ];
    const s = sceneAt(
      objects,
      [
        at(0, {
          do: "move",
          target: { id: "r" },
          to: { x: 1, y: 1 },
          durationMs: 0,
        }),
        at(0, {
          do: "move",
          target: { id: "t" },
          to: { x: 200, y: 200 },
          durationMs: 0,
        }),
      ],
      0,
    );
    expect(obj(s, "r").object).toEqual(objects[3]);
    expect(resolveAnchor(s, { id: "t" })).toEqual({ x: 200, y: 200 });
    expect(resolveAnchor(s, { id: "r" })).toEqual({ x: 100, y: 100 });
  });

  it("a move's path is fixed when it starts", () => {
    // The anchor moves after the move began; the move still ends where the
    // anchor was at its start.
    const s = sceneAt(
      board(),
      [
        at(0, { do: "move", target: { id: "h" }, to: { id: "t" } }),
        at(100, {
          do: "move",
          target: { id: "t" },
          to: { x: 0, y: 0 },
          durationMs: 0,
        }),
      ],
      400,
    );
    expect(obj(s, "h").object).toMatchObject({ x: 500, y: 500 });
  });
});

// ---------------------------------------------------------------- write

describe("sceneAt: write", () => {
  it("write replaces a text object's text", () => {
    const s = sceneAt(
      board(),
      [at(0, { do: "write", target: { id: "t" }, value: "19" })],
      0,
    );
    expect(obj(s, "t").object).toMatchObject({ text: "19" });
  });

  it("write replaces a matrix cell's value", () => {
    const s = sceneAt(
      board(),
      [at(0, { do: "write", target: { id: "m", row: 1, col: 0 }, value: "x" })],
      0,
    );
    expect(obj(s, "m").object).toMatchObject({
      rows: [
        ["1", "2"],
        ["x", "4"],
      ],
    });
  });
});

// ---------------------------------------------------------------- no-ops

describe("sceneAt: an action that changes nothing is never active", () => {
  it("a show of a visible object", () => {
    const s = sceneAt(
      board(),
      [at(0, { do: "show", target: { id: "t" } })],
      200,
    );
    expect(s.active).toEqual([]);
  });

  it("a highlight in the colour the cells already have", () => {
    const timed = [
      at(0, { do: "highlight", target: { id: "m", row: 0 }, durationMs: 0 }),
      at(1000, { do: "highlight", target: { id: "m", row: 0 } }),
      at(1000, { do: "highlight", target: { id: "m", row: 0, col: 1 } }),
    ];
    expect(sceneAt(board(), timed, 1200).active).toEqual([]);
  });

  it("a highlight during an identical one in progress: the first keeps fading in", () => {
    const first = at(0, { do: "highlight", target: { id: "t" } });
    const s = sceneAt(
      board(),
      [first, at(100, { do: "highlight", target: { id: "t" } })],
      200,
    );
    expect(s.active).toEqual([{ action: first.action, progress: 0.5 }]);
  });

  it("a write of the value already there", () => {
    const s = sceneAt(
      board(),
      [
        at(0, { do: "write", target: { id: "t" }, value: "hi" }),
        at(0, { do: "write", target: { id: "m", row: 0, col: 1 }, value: "2" }),
      ],
      200,
    );
    expect(s.active).toEqual([]);
  });

  it("a hide of a hidden object, an unhighlight of nothing, a hide of a part that never moved", () => {
    const s = sceneAt(
      board(),
      [
        at(0, { do: "hide", target: { id: "h" } }),
        at(0, { do: "unhighlight", target: { id: "m" } }),
        at(0, { do: "hide", target: { id: "m", row: 0 } }),
      ],
      200,
    );
    expect(s.active).toEqual([]);
  });

  it("a show during a hide in progress is active (the hide would leave it hidden)", () => {
    const show = at(200, { do: "show", target: { id: "t" } });
    const s = sceneAt(
      board(),
      [at(0, { do: "hide", target: { id: "t" } }), show],
      300,
    );
    expect(s.active.map((a) => a.action)).toContainEqual(show.action);
  });

  it("a hide during a show in progress is active (the show would leave it visible)", () => {
    const hide = at(200, { do: "hide", target: { id: "h" } });
    const s = sceneAt(
      board(),
      [at(0, { do: "show", target: { id: "h" } }), hide],
      300,
    );
    expect(s.active.map((a) => a.action)).toContainEqual(hide.action);
  });

  it("a shorter hide during a longer one is active (it hides the object first)", () => {
    const short = at(100, { do: "hide", target: { id: "t" }, durationMs: 200 });
    const s = sceneAt(
      board(),
      [at(0, { do: "hide", target: { id: "t" }, durationMs: 1000 }), short],
      200,
    );
    expect(s.active.map((a) => a.action)).toContainEqual(short.action);
  });

  it("a hide leaves active once a later show of the same object has ended", () => {
    const timed = [
      at(0, { do: "hide", target: { id: "t" }, durationMs: 1000 }),
      at(300, { do: "show", target: { id: "t" } }),
    ];
    expect(sceneAt(board(), timed, 600).active).toHaveLength(2);
    const after = sceneAt(board(), timed, 800);
    expect(after.active).toEqual([]);
    expect(obj(after, "t").visible).toBe(true);
    expect(obj(sceneAt(board(), timed, 1000), "t").visible).toBe(true);
  });

  it("a highlight that changes at least one cell is active", () => {
    const timed = [
      at(0, { do: "highlight", target: { id: "m", row: 0 }, durationMs: 0 }),
      at(1000, { do: "highlight", target: { id: "m" } }),
      at(1000, { do: "highlight", target: { id: "m", row: 0 }, color: "warn" }),
    ];
    // timed[1] changed row 1; row 0 was accent already, then warn overwrote it.
    expect(sceneAt(board(), timed, 1200).active).toEqual([
      {
        action: timed[1].action,
        progress: 0.5,
        cells: [
          [1, 0],
          [1, 1],
        ],
      },
      {
        action: timed[2].action,
        progress: 0.5,
        cells: [
          [0, 0],
          [0, 1],
        ],
      },
    ]);
  });
});

describe("sceneAt: the cells a matrix action changed", () => {
  const cellsAt = (timed: TimedAction[], tMs: number) =>
    sceneAt(board(), timed, tMs).active.map((a) => a.cells);

  it("a highlight lists only the cells that didn't have its colour", () => {
    const timed = [
      at(0, { do: "highlight", target: { id: "m", row: 0 }, durationMs: 0 }),
      at(1000, { do: "highlight", target: { id: "m" } }),
    ];
    expect(cellsAt(timed, 1200)).toEqual([
      [
        [1, 0],
        [1, 1],
      ],
    ]);
  });

  it("a cell a later action changed leaves the earlier action's cells", () => {
    // accent fading in, then a 0 ms warn and a 0 ms accent on cell 0,0:
    // the cell is accent at once, so the first action no longer fades it.
    const timed = [
      at(0, { do: "highlight", target: { id: "m", row: 0 }, durationMs: 1000 }),
      at(100, {
        do: "highlight",
        target: { id: "m", row: 0, col: 0 },
        color: "warn",
        durationMs: 0,
      }),
      at(200, {
        do: "highlight",
        target: { id: "m", row: 0, col: 0 },
        durationMs: 0,
      }),
    ];
    expect(cellsAt(timed, 500)).toEqual([[[0, 1]]]);
  });

  it("a write on another cell, or a highlight, doesn't take a write's cell", () => {
    const timed = [
      at(0, { do: "write", target: { id: "m", row: 0, col: 0 }, value: "9" }),
      at(100, { do: "highlight", target: { id: "m" }, durationMs: 0 }),
      at(100, {
        do: "write",
        target: { id: "m", row: 1, col: 1 },
        value: "8",
        durationMs: 0,
      }),
    ];
    expect(cellsAt(timed, 200)).toEqual([[[0, 0]]]);
  });

  it("a later write to the same cell takes it from an earlier write", () => {
    const timed = [
      at(0, { do: "write", target: { id: "m", row: 0, col: 0 }, value: "9" }),
      at(100, {
        do: "write",
        target: { id: "m", row: 0, col: 0 },
        value: "7",
        durationMs: 0,
      }),
    ];
    expect(cellsAt(timed, 200)).toEqual([[]]);
  });

  it("an unhighlight lists the cells it cleared", () => {
    const timed = [
      at(0, { do: "highlight", target: { id: "m", row: 0 }, durationMs: 0 }),
      at(100, { do: "unhighlight", target: { id: "m" } }),
    ];
    expect(cellsAt(timed, 200)).toEqual([
      [
        [0, 0],
        [0, 1],
      ],
    ]);
  });

  it("an unhighlight then a re-highlight take the cells from an earlier highlight", () => {
    // accent fading in on row 0; cell 0,0 is cleared, then accent again at
    // once: it shows fully, so the first highlight keeps only 0,1.
    const timed = [
      at(0, { do: "highlight", target: { id: "m", row: 0 }, durationMs: 1000 }),
      at(100, {
        do: "unhighlight",
        target: { id: "m", row: 0, col: 0 },
        durationMs: 0,
      }),
      at(200, {
        do: "highlight",
        target: { id: "m", row: 0, col: 0 },
        durationMs: 0,
      }),
    ];
    expect(cellsAt(timed, 500)).toEqual([[[0, 1]]]);
  });

  it("actions on other objects have no cells", () => {
    const timed = [at(0, { do: "highlight", target: { id: "t" } })];
    expect(sceneAt(board(), timed, 100).active[0]).not.toHaveProperty("cells");
  });
});

// ---------------------------------------------------------------- robustness

describe("sceneAt: robustness", () => {
  it("ignores actions on unknown or out-of-range targets", () => {
    const timed = [
      at(0, { do: "highlight", target: { id: "nope" } }),
      at(0, { do: "highlight", target: { id: "m", row: 7 } }),
      at(0, { do: "write", target: { id: "m", row: 0 }, value: "x" }),
      at(0, { do: "move", target: { id: "m", col: 9 }, to: { x: 0, y: 0 } }),
      at(0, { do: "move", target: { id: "t" }, to: { id: "nope" } }),
      at(0, { do: "write", target: { id: "t", row: 0 }, value: "x" }),
      at(0, { do: "show", target: { id: "h", row: 0 } }),
    ];
    // Mid-animation too: ignored actions are never listed as active.
    for (const t of [200, 1000])
      expect(sceneAt(board(), timed, t)).toEqual(sceneAt(board(), [], t));
  });

  it("a move on an arrow is ignored and never active", () => {
    const objects: BoardObject[] = [
      ...board(),
      { kind: "arrow", id: "r", from: { id: "t" }, to: { x: 0, y: 0 } },
    ];
    const s = sceneAt(
      objects,
      [at(0, { do: "move", target: { id: "r" }, to: { x: 1, y: 1 } })],
      200,
    );
    expect(s.active).toEqual([]);
  });

  it("the active actions are copies: changing the output never changes the input", () => {
    const timed = [at(0, { do: "highlight", target: { id: "t" } })];
    const s = sceneAt(board(), timed, 100);
    s.active[0].action.durationMs = 1;
    expect(timed[0].action.durationMs).toBe(400);
  });

  it("timeline ignores cue names that only exist on Object.prototype", () => {
    const action = {
      cue: "constructor",
      do: "show" as const,
      target: { id: "h" },
      durationMs: 400,
    };
    expect(timeline([action], {})).toEqual([]);
  });

  it("timeline keeps an action cued on constructor when narrationCueTimes times it", () => {
    const action = {
      cue: "constructor",
      do: "show" as const,
      target: { id: "h" },
      durationMs: 400,
    };
    const text = "Call the constructor now";
    // One alignment entry per code point, 100 ms apart: the cue is at "c", entry 9.
    const cueTimes = narrationCueTimes(
      "Call the [[constructor]]constructor now",
      {
        characters: [...text],
        character_start_times_seconds: [...text].map((_, i) => i * 0.1),
        character_end_times_seconds: [...text].map((_, i) => i * 0.1 + 0.08),
      },
    );
    expect(timeline([action], cueTimes)).toEqual([
      { action, startMs: 900, durationMs: 400 },
    ]);
  });

  it("never mutates its inputs", () => {
    const objects = board();
    const timed = [
      at(0, { do: "move", target: { id: "m" }, to: { x: 800, y: 400 } }),
      at(0, { do: "write", target: { id: "t" }, value: "x" }),
    ];
    const before = structuredClone({ objects, timed });
    sceneAt(objects, timed, 1000);
    expect({ objects, timed }).toEqual(before);
  });

  it("the output passes the BoardState schema", () => {
    const step = Step.parse(demoM1);
    const s = sceneAt(step.objects, timeline(step.actions, demoCueTimes), 4000);
    expect(BoardState.safeParse(s).success).toBe(true);
  });

  it("timeline skips actions whose cue has no time", () => {
    const step = Step.parse(demoM1);
    const t = timeline(step.actions, { row: 100 });
    expect(t).toEqual([
      { action: step.actions[0], startMs: 100, durationMs: 300 },
    ]);
  });
});

// ---------------------------------------------------------------- demo-m1

/** Hand-picked cue times for the M1 narration (ms). */
const demoCueTimes = {
  row: 1000,
  col: 2000,
  slide: 3000,
  pair1: 4500,
  pair2: 5500,
  add: 6500,
  total: 7500,
  drop: 8000,
  done: 8800,
};

describe("sceneAt: demo-m1.step.json", () => {
  const step = Step.parse(demoM1);
  const timed = timeline(step.actions, demoCueTimes);
  const s = (t: number) => sceneAt(step.objects, timed, t);

  it("the fixture is a valid step", () => {
    expect(validateStep(demoM1, { maxNarrationChars: 2000 }).ok).toBe(true);
  });

  it("at 0: a, b and c visible; p1, p2 and sum hidden; nothing highlighted", () => {
    const b = s(0);
    for (const id of ["a", "b", "c"]) expect(obj(b, id).visible).toBe(true);
    for (const id of ["p1", "p2", "sum"])
      expect(obj(b, id).visible).toBe(false);
    expect(
      obj(b, "a")
        .cellHighlight?.flat()
        .every((h) => h === null),
    ).toBe(true);
  });

  it("after [[col]]: row 0 of a and column 0 of b highlighted", () => {
    const b = s(2500);
    expect(obj(b, "a").cellHighlight).toEqual([
      ["accent", "accent"],
      [null, null],
    ]);
    expect(obj(b, "b").cellHighlight).toEqual([
      ["accent", null],
      ["accent", null],
    ]);
  });

  it("mid [[slide]]: the row and column copies slide together", () => {
    const b = s(3400);
    expect(b.copies).toHaveLength(2);
    expect(b.active.map((a) => a.progress)).toEqual([0.5, 0.5]);
    const row = copy(b, "a", 0);
    const col = copy(b, "b", undefined, 0);
    // Half way from their source centres to their points.
    expect(row).toMatchObject({ x: (224 + 850) / 2, y: (184 + 184) / 2 });
    expect(col).toMatchObject({ x: (472 + 1000) / 2, y: (208 + 208) / 2 });
    // The matrices stay whole.
    expect(obj(b, "a").object).toEqual(step.objects[0]);
    expect(obj(b, "b").object).toEqual(step.objects[2]);
  });

  it("after [[total]]: p1, p2 and sum visible, sum reads 19", () => {
    const b = s(7900);
    for (const id of ["p1", "p2", "sum"]) expect(obj(b, id).visible).toBe(true);
    expect(obj(b, "sum").object).toMatchObject({ text: "19" });
    expect(copy(b, "a", 0)).toMatchObject({ x: 850, y: 184, visible: true });
  });

  it("mid [[drop]]: sum is on its way to cell (0, 0) of c", () => {
    const b = s(8300);
    const target = cellCentre(1200, 160, 0, 0);
    expect(obj(b, "sum").object).toMatchObject({
      x: (925 + target.x) / 2,
      y: (420 + target.y) / 2,
    });
  });

  it("after [[done]]: 19 in c(0,0), sum and both copies hidden", () => {
    const b = s(20_000);
    expect(obj(b, "sum").object).toMatchObject(cellCentre(1200, 160, 0, 0));
    expect(obj(b, "sum").visible).toBe(false);
    expect(obj(b, "c").object).toMatchObject({
      rows: [
        ["19", ""],
        ["", ""],
      ],
    });
    expect(b.copies).toEqual([]);
    expect(b.active).toEqual([]);
  });
});

// ---------------------------------------------------------------- properties

const id = fc.constantFrom("m", "t", "h", "nope");
const target = fc.record(
  {
    id,
    row: fc.integer({ min: 0, max: 2 }),
    col: fc.integer({ min: 0, max: 2 }),
  },
  { requiredKeys: ["id"] },
);
const point = fc.record({
  x: fc.integer({ min: 0, max: 1600 }),
  y: fc.integer({ min: 0, max: 900 }),
});
const action: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    do: fc.constantFrom("show", "hide"),
    target,
    durationMs: fc.integer({ min: 0, max: 3000 }),
  }),
  fc.record(
    {
      do: fc.constantFrom("highlight", "unhighlight"),
      target,
      color: fc.constantFrom("accent", "warn"),
      durationMs: fc.integer({ min: 0, max: 3000 }),
    },
    { requiredKeys: ["do", "target", "durationMs"] },
  ),
  fc.record({
    do: fc.constant("move"),
    target,
    to: fc.oneof(target, point),
    durationMs: fc.integer({ min: 0, max: 3000 }),
  }),
  fc.record({
    do: fc.constant("write"),
    target,
    value: fc.string({ maxLength: 4 }),
    durationMs: fc.integer({ min: 0, max: 3000 }),
  }),
) as fc.Arbitrary<Action>;
const timedArb = fc.array(
  fc
    .record({ action, startMs: fc.integer({ min: 0, max: 10_000 }) })
    .map(({ action, startMs }) => ({
      action,
      startMs,
      durationMs: action.durationMs,
    })),
  { maxLength: 12 },
);
const time = fc.integer({ min: -100, max: 14_000 });

describe("sceneAt (property)", () => {
  it("the same inputs give the same output", () => {
    fc.assert(
      fc.property(timedArb, time, (timed, t) => {
        expect(sceneAt(board(), timed, t)).toEqual(
          sceneAt(structuredClone(board()), structuredClone(timed), t),
        );
      }),
    );
  });

  it("seek order doesn't matter: any sequence of earlier seeks gives the same state", () => {
    fc.assert(
      fc.property(
        timedArb,
        fc.array(time, { maxLength: 6 }),
        time,
        (timed, seeks, t) => {
          const objects = board();
          const fresh = sceneAt(objects, timed, t);
          for (const s of seeks) sceneAt(objects, timed, s);
          expect(sceneAt(objects, timed, t)).toEqual(fresh);
        },
      ),
    );
  });

  it("progress is always within 0..1 and the output passes the schema", () => {
    fc.assert(
      fc.property(timedArb, time, (timed, t) => {
        const s = sceneAt(board(), timed, t);
        for (const a of s.active) {
          expect(a.progress).toBeGreaterThanOrEqual(0);
          expect(a.progress).toBeLessThan(1);
        }
        expect(BoardState.safeParse(s).success).toBe(true);
      }),
    );
  });
});
