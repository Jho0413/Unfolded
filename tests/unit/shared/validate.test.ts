// One test per row of the ARCHITECTURE.md section 4 validation table, named
// after the row, plus the M1 demo fixture as the contract's acceptance test.
import { describe, expect, it } from "vitest";
import demoM1 from "@/lib/fakes/fixtures/demo-m1.step.json";
import type { BoardObject, BoardState, Sketch, Step } from "@/shared/scene";
import {
  validateSketch,
  validateStep,
  type ValidationResult,
} from "@/shared/validate";

const limits = { maxNarrationChars: 2000 };

/** A small valid step: matrix m (2 x 2), text t, latex l, arrow r, image i. */
function baseStep(): Step {
  return {
    title: "Base",
    narration: "Look at [[one]]this row, then [[two]]that text.",
    objects: [
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
      { kind: "text", id: "t", x: 600, y: 300, text: "hi" },
      { kind: "latex", id: "l", x: 800, y: 300, tex: "\\frac{a}{b}" },
      { kind: "arrow", id: "r", from: { id: "m" }, to: { id: "t" } },
      {
        kind: "image",
        id: "i",
        x: 1000,
        y: 500,
        w: 200,
        h: 100,
        prompt: "a cat",
      },
    ],
    actions: [
      {
        cue: "one",
        do: "highlight",
        target: { id: "m", row: 0 },
        durationMs: 400,
      },
      {
        cue: "two",
        do: "write",
        target: { id: "t" },
        value: "bye",
        durationMs: 400,
      },
    ],
  };
}

type Edit = (s: Step) => void;
function stepWith(edit: Edit): Step {
  const s = baseStep();
  edit(s);
  return s;
}

function addAction(action: Record<string, unknown>): Edit {
  return (s) => {
    s.actions.push({
      cue: "one",
      durationMs: 400,
      ...action,
    } as Step["actions"][number]);
  };
}

function expectValid<T>(r: ValidationResult<T>): void {
  if (!r.ok) throw new Error(`expected valid, got ${JSON.stringify(r.errors)}`);
}

function expectErrors<T>(r: ValidationResult<T>, ...errs: string[]): void {
  expect(r.ok).toBe(false);
  if (!r.ok) for (const e of errs) expect(r.errors).toContain(e);
}

function board(objects: BoardObject[]): BoardState {
  return {
    objects: objects.map((object) => ({
      object,
      visible: true,
      highlight: null,
    })),
    copies: [],
    active: [],
  };
}

const lessonBoard = board(baseStep().objects);

describe("validate: ARCHITECTURE.md section 4 table", () => {
  it("Every rule holds: valid", () => {
    expectValid(validateStep(baseStep(), limits));
  });

  it("The output fails the zod schema: rejected: the schema error", () => {
    const r = validateStep(
      { title: "x", narration: "y", objects: [{ kind: "blob" }] },
      limits,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.errors.some((e) => e.includes("objects"))).toBe(true);
    }
  });

  it('A cue in actions doesn\'t appear in narration: rejected: unknown cue "x"', () => {
    expectErrors(
      validateStep(
        stepWith(addAction({ cue: "x", do: "show", target: { id: "t" } })),
        limits,
      ),
      'unknown cue "x"',
    );
  });

  it('A marker appears twice in narration: rejected: duplicate cue "x"', () => {
    expectErrors(
      validateStep(
        stepWith((s) => (s.narration += " Again [[x]]and [[x]]again.")),
        limits,
      ),
      'duplicate cue "x"',
    );
  });

  describe('A malformed marker ([[Row 1]], a stray [[ or ]]): rejected: malformed marker "[[Row 1]]"', () => {
    it("[[Row 1]]", () => {
      expectErrors(
        validateStep(
          stepWith((s) => (s.narration += " Take [[Row 1]]it.")),
          limits,
        ),
        'malformed marker "[[Row 1]]"',
      );
    });
    it("a stray [[", () => {
      expectErrors(
        validateStep(
          stepWith((s) => (s.narration += " Oops [[ here.")),
          limits,
        ),
        'malformed marker "[["',
      );
    });
    it("a stray ]]", () => {
      expectErrors(
        validateStep(
          stepWith((s) => (s.narration += " Oops ]] here.")),
          limits,
        ),
        'malformed marker "]]"',
      );
    });
  });

  it("A marker in narration that no action uses: allowed (it's ignored)", () => {
    expectValid(
      validateStep(
        stepWith((s) => (s.narration += " And [[unused]]so on.")),
        limits,
      ),
    );
  });

  describe('A target.id, or an anchor\'s id, with no object: rejected: unknown object "x"', () => {
    it("target.id", () => {
      expectErrors(
        validateStep(
          stepWith(addAction({ do: "highlight", target: { id: "x" } })),
          limits,
        ),
        'unknown object "x"',
      );
    });
    it("a move anchor's id", () => {
      expectErrors(
        validateStep(
          stepWith(
            addAction({ do: "move", target: { id: "t" }, to: { id: "x" } }),
          ),
          limits,
        ),
        'unknown object "x"',
      );
    });
    it("an arrow anchor's id", () => {
      expectErrors(
        validateStep(
          stepWith((s) =>
            s.objects.push({
              kind: "arrow",
              id: "r2",
              from: { id: "m" },
              to: { id: "x" },
            }),
          ),
          limits,
        ),
        'unknown object "x"',
      );
    });
  });

  describe("row or col outside the matrix, or set on a non-matrix (in a target or an anchor): rejected: target out of range", () => {
    it("row outside the matrix in a target", () => {
      expectErrors(
        validateStep(
          stepWith(addAction({ do: "highlight", target: { id: "m", row: 2 } })),
          limits,
        ),
        "target out of range",
      );
    });
    it("col outside the matrix in an anchor", () => {
      expectErrors(
        validateStep(
          stepWith(
            addAction({
              do: "move",
              target: { id: "t" },
              to: { id: "m", row: 0, col: 2 },
            }),
          ),
          limits,
        ),
        "target out of range",
      );
    });
    it("row set on a non-matrix target", () => {
      expectErrors(
        validateStep(
          stepWith(addAction({ do: "highlight", target: { id: "t", row: 0 } })),
          limits,
        ),
        "target out of range",
      );
    });
    it("col set on a non-matrix arrow anchor", () => {
      expectErrors(
        validateStep(
          stepWith((s) =>
            s.objects.push({
              kind: "arrow",
              id: "r2",
              from: { id: "t", col: 0 },
              to: { id: "m" },
            }),
          ),
          limits,
        ),
        "target out of range",
      );
    });
  });

  it("write on a matrix without both row and col: rejected: write needs a cell", () => {
    expectErrors(
      validateStep(
        stepWith(
          addAction({ do: "write", target: { id: "m", row: 0 }, value: "9" }),
        ),
        limits,
      ),
      "write needs a cell",
    );
    expectErrors(
      validateStep(
        stepWith(addAction({ do: "write", target: { id: "m" }, value: "9" })),
        limits,
      ),
      "write needs a cell",
    );
  });

  it('write on a latex, arrow or image: rejected: can\'t write to "x"', () => {
    for (const id of ["l", "r", "i"]) {
      expectErrors(
        validateStep(
          stepWith(addAction({ do: "write", target: { id }, value: "9" })),
          limits,
        ),
        `can't write to "${id}"`,
      );
    }
  });

  it("show with row or col: rejected: show needs a whole object", () => {
    expectErrors(
      validateStep(
        stepWith(addAction({ do: "show", target: { id: "m", row: 0 } })),
        limits,
      ),
      "show needs a whole object",
    );
    expectErrors(
      validateStep(
        stepWith(addAction({ do: "show", target: { id: "m", col: 1 } })),
        limits,
      ),
      "show needs a whole object",
    );
  });

  it('move on an arrow: rejected: can\'t move "x"', () => {
    expectErrors(
      validateStep(
        stepWith(
          addAction({ do: "move", target: { id: "r" }, to: { x: 10, y: 10 } }),
        ),
        limits,
      ),
      `can't move "r"`,
    );
  });

  it("show on a visible object, hide on a hidden one, or hide on a part that hasn't moved: allowed (no change)", () => {
    const s = stepWith((s) => {
      (s.objects[1] as { hidden?: boolean }).hidden = true;
      addAction({ do: "show", target: { id: "m" } })(s);
      addAction({ do: "hide", target: { id: "t" } })(s);
      addAction({ do: "hide", target: { id: "m", row: 1 } })(s);
    });
    expectValid(validateStep(s, limits));
  });

  it('tex that KaTeX can\'t parse: rejected: invalid LaTeX in "x"', () => {
    expectErrors(
      validateStep(
        stepWith((s) =>
          s.objects.push({
            kind: "latex",
            id: "x",
            x: 10,
            y: 10,
            tex: "\\frac{a",
          }),
        ),
        limits,
      ),
      'invalid LaTeX in "x"',
    );
  });

  describe("An object, or an {x, y} point in an anchor, outside the 1600 x 900 canvas: rejected: off canvas", () => {
    const off = (edit: Edit) =>
      expectErrors(validateStep(stepWith(edit), limits), "off canvas");
    it("a matrix whose cell box crosses the right edge", () => {
      // 2 columns x 64 = 128 wide: x = 1500 ends at 1628.
      off((s) =>
        s.objects.push({
          kind: "matrix",
          id: "x",
          x: 1500,
          y: 0,
          rows: [["1", "2"]],
        }),
      );
    });
    it("a matrix whose cell box exactly fits is on canvas", () => {
      expectValid(
        validateStep(
          stepWith((s) =>
            s.objects.push({
              kind: "matrix",
              id: "x",
              x: 1472,
              y: 852,
              rows: [["1", "2"]],
            }),
          ),
          limits,
        ),
      );
    });
    it("text and latex: only their x,y", () => {
      off((s) =>
        s.objects.push({ kind: "text", id: "x", x: -1, y: 10, text: "a" }),
      );
      off((s) =>
        s.objects.push({ kind: "latex", id: "x", x: 10, y: 901, tex: "a" }),
      );
      // A long text centred near the edge is fine: only x,y is checked.
      expectValid(
        validateStep(
          stepWith((s) =>
            s.objects.push({
              kind: "text",
              id: "x",
              x: 1600,
              y: 900,
              text: "a long label",
            }),
          ),
          limits,
        ),
      );
    });
    it("an image box", () => {
      off((s) =>
        s.objects.push({
          kind: "image",
          id: "x",
          x: 1500,
          y: 0,
          w: 200,
          h: 100,
          prompt: "p",
        }),
      );
    });
    it("a point in an arrow anchor", () => {
      off((s) =>
        s.objects.push({
          kind: "arrow",
          id: "x",
          from: { x: 10, y: 10 },
          to: { x: 2000, y: 10 },
        }),
      );
    });
    it("a point in a move anchor", () => {
      off(addAction({ do: "move", target: { id: "t" }, to: { x: 10, y: -5 } }));
    });
  });

  it('Two objects with the same id: rejected: duplicate id "x"', () => {
    expectErrors(
      validateStep(
        stepWith((s) =>
          s.objects.push({ kind: "text", id: "t", x: 1, y: 1, text: "again" }),
        ),
        limits,
      ),
      'duplicate id "t"',
    );
  });

  it("Narration longer than config.maxNarrationChars after the markers are stripped: rejected: narration too long", () => {
    const s = stepWith((s) => (s.narration = "[[one]]abcde  [[two]]fgh"));
    // Stripped: "abcde fgh" = 9 characters.
    expectValid(validateStep(s, { maxNarrationChars: 9 }));
    expectErrors(
      validateStep(s, { maxNarrationChars: 8 }),
      "narration too long",
    );
  });

  const sketch: Sketch = {
    objects: [{ kind: "text", id: "note", x: 400, y: 600, text: "why?" }],
    actions: [
      {
        atMs: 0,
        do: "highlight",
        target: { id: "m", row: 0 },
        durationMs: 400,
      },
      {
        atMs: 500,
        do: "move",
        target: { id: "note" },
        to: { id: "m", row: 1, col: 1 },
        durationMs: 400,
      },
    ],
  };

  it("A sketch action or anchor uses an id from the board the sketch draws on: valid", () => {
    expectValid(validateSketch(sketch, { board: lessonBoard }));
  });

  it('The same, with fresh: true (the board is empty): rejected: unknown object "x"', () => {
    expectErrors(
      validateSketch(sketch, { board: lessonBoard, fresh: true }),
      'unknown object "m"',
    );
  });

  it('A sketch object reuses an id from the board it draws on: rejected: duplicate id "x"', () => {
    const reuse: Sketch = {
      objects: [{ kind: "text", id: "t", x: 400, y: 600, text: "dup" }],
      actions: [],
    };
    expectErrors(
      validateSketch(reuse, { board: lessonBoard }),
      'duplicate id "t"',
    );
    // With fresh: true the board is empty, so the id is free.
    expectValid(validateSketch(reuse, { board: lessonBoard, fresh: true }));
  });
});

describe("demo-m1.step.json (the contract's acceptance test)", () => {
  const r = validateStep(demoM1, limits);

  it("passes validation", () => {
    expectValid(r);
  });

  it("expresses the whole M1 demo", () => {
    if (!r.ok) throw new Error("invalid");
    const step = r.value;
    const at = (cue: string) => step.actions.filter((a) => a.cue === cue);

    // Row and column slide together on one cue, as copies.
    const slide = at("slide");
    expect(slide.map((a) => [a.do, a.target])).toEqual([
      ["move", { id: "a", row: 0 }],
      ["move", { id: "b", col: 0 }],
    ]);
    // The pairs multiply: hidden products appear.
    expect(step.objects.filter((o) => o.hidden).map((o) => o.id)).toEqual([
      "p1",
      "p2",
      "sum",
    ]);
    expect(at("pair1")[0]).toMatchObject({ do: "show", target: { id: "p1" } });
    expect(at("pair2")[0]).toMatchObject({ do: "show", target: { id: "p2" } });
    expect(at("total")[0]).toMatchObject({
      do: "write",
      target: { id: "sum" },
      value: "19",
    });
    // The sum drops into (1,1), which is { row: 0, col: 0 }.
    expect(at("drop")[0]).toMatchObject({
      do: "move",
      target: { id: "sum" },
      to: { id: "c", row: 0, col: 0 },
    });
    expect(at("done")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          do: "write",
          target: { id: "c", row: 0, col: 0 },
          value: "19",
        }),
        expect.objectContaining({ do: "hide", target: { id: "sum" } }),
        expect.objectContaining({ do: "hide", target: { id: "a", row: 0 } }),
        expect.objectContaining({ do: "hide", target: { id: "b", col: 0 } }),
      ]),
    );
  });
});
