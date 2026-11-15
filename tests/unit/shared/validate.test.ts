// One test per row of the ARCHITECTURE.md section 4 validation table, named
// after the row, plus the M1 demo fixture as the contract's acceptance test.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import demoM1 from "@/lib/fakes/fixtures/demo-m1.step.json";
import { type Box, boxGap, objectBox } from "@/shared/boxes";
import {
  type BoardObject,
  type BoardState,
  MAX_PAPER_QUOTE_CHARS,
  type Sketch,
  type Step,
} from "@/shared/scene";
import {
  ANSWER_TEMPLATE,
  errors,
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

  it("A paper ref's cue doesn't appear in narration: rejected: unknown cue \"x\"", () => {
    expectErrors(
      validateStep(
        stepWith((s) => (s.paperRefs = [{ page: 1, quote: "q", cue: "x" }])),
        limits,
      ),
      'unknown cue "x"',
    );
  });

  it("A paper ref on a narration cue, or with no cue (from the step's start): valid", () => {
    expectValid(
      validateStep(
        stepWith(
          (s) =>
            (s.paperRefs = [
              { page: 2, quote: "from the start" },
              { page: 3, quote: "at one", cue: "one", label: "Eq. 1" },
            ]),
        ),
        limits,
      ),
    );
  });

  it("A step with no paperRefs (older runs): valid, and none are added", () => {
    const r = validateStep(baseStep(), limits);
    expectValid(r);
    if (r.ok) expect(r.value).not.toHaveProperty("paperRefs");
  });

  it("A paper ref with page 0, an empty quote or a quote over the cap: rejected: the schema error", () => {
    for (const ref of [
      { page: 0, quote: "q" },
      { page: 1, quote: "" },
      { page: 1, quote: "x".repeat(MAX_PAPER_QUOTE_CHARS + 1) },
    ])
      expect(
        validateStep(
          stepWith((s) => (s.paperRefs = [ref])),
          limits,
        ).ok,
      ).toBe(false);
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

  describe('row or col outside the matrix, or set on a non-matrix (in a target or an anchor): rejected: target out of range "x"', () => {
    it("row outside the matrix in a target", () => {
      expectErrors(
        validateStep(
          stepWith(addAction({ do: "highlight", target: { id: "m", row: 2 } })),
          limits,
        ),
        'target out of range "m"',
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
        'target out of range "m"',
      );
    });
    it("names each object, so two bad targets give two errors", () => {
      expectErrors(
        validateStep(
          stepWith((s) => {
            addAction({ do: "highlight", target: { id: "m", row: 2 } })(s);
            addAction({ do: "highlight", target: { id: "t", row: 0 } })(s);
          }),
          limits,
        ),
        'target out of range "m"',
        'target out of range "t"',
      );
    });
    it("row set on a non-matrix target", () => {
      expectErrors(
        validateStep(
          stepWith(addAction({ do: "highlight", target: { id: "t", row: 0 } })),
          limits,
        ),
        'target out of range "t"',
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
        'target out of range "t"',
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

  describe('tex that KaTeX can\'t parse, or that uses a command trust: false refuses (\\href, \\url, \\includegraphics, \\htmlClass and the like): rejected: invalid LaTeX in "x"', () => {
    const latex = (tex: string) =>
      validateStep(
        stepWith((s) =>
          s.objects.push({ kind: "latex", id: "x", x: 10, y: 10, tex }),
        ),
        limits,
      );
    it("tex KaTeX can't parse", () => {
      expectErrors(latex("\\frac{a"), 'invalid LaTeX in "x"');
    });
    it.each([
      "\\href{https://example.com}{a}",
      "\\url{https://example.com}",
      "\\htmlClass{a}{b}",
      "\\htmlId{a}{b}",
      "\\htmlStyle{color:red}{b}",
      "\\htmlData{a=b}{c}",
      "\\includegraphics{x.png}",
      "x^2 + \\href{javascript:alert(1)}{y}",
    ])("%s", (tex) => {
      expectErrors(latex(tex), 'invalid LaTeX in "x"');
    });
    it("tex with no such command is still valid", () => {
      expectValid(latex("\\textcolor{red}{x^2} + \\frac{1}{2}"));
    });
  });

  describe('An object, or an {x, y} point in an anchor, outside the 1600 x 900 canvas: rejected: off canvas "x"', () => {
    const off = (edit: Edit, id = "x") =>
      expectErrors(validateStep(stepWith(edit), limits), `off canvas "${id}"`);
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
    it("names each object, so two off-canvas objects give two errors", () => {
      expectErrors(
        validateStep(
          stepWith((s) =>
            s.objects.push(
              { kind: "text", id: "q", x: -1, y: 10, text: "a" },
              { kind: "text", id: "r", x: 1601, y: 10, text: "b" },
            ),
          ),
          limits,
        ),
        'off canvas "q"',
        'off canvas "r"',
      );
    });
    it("a point in a move anchor", () => {
      // Named after the object that moves there.
      off(
        addAction({ do: "move", target: { id: "t" }, to: { x: 10, y: -5 } }),
        "t",
      );
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
    const s = stepWith((s) => (s.narration = "  [[one]]abcde  [[two]]fgh \n"));
    // Stripped, trimmed and collapsed: "abcde fgh" = 9 characters.
    expectValid(validateStep(s, { maxNarrationChars: 9 }));
    expectErrors(
      validateStep(s, { maxNarrationChars: 8 }),
      "narration too long",
    );
  });

  it("Narration with nothing left after the markers are stripped (only markers or spaces): rejected: narration empty", () => {
    expectErrors(
      validateStep(
        stepWith((s) => (s.narration = " [[one]]  [[two]]\n ")),
        limits,
      ),
      "narration empty",
    );
  });

  it('An arrow end that names an arrow (itself, or arrows anchored to each other): rejected: can\'t anchor to "x"', () => {
    expectErrors(
      validateStep(
        stepWith((s) =>
          s.objects.push({
            kind: "arrow",
            id: "x",
            from: { id: "x" },
            to: { id: "m" },
          }),
        ),
        limits,
      ),
      `can't anchor to "x"`,
    );
    expectErrors(
      validateStep(
        stepWith((s) =>
          s.objects.push(
            { kind: "arrow", id: "x", from: { id: "y" }, to: { id: "m" } },
            { kind: "arrow", id: "y", from: { id: "x" }, to: { id: "m" } },
          ),
        ),
        limits,
      ),
      `can't anchor to "x"`,
      `can't anchor to "y"`,
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
    // A fresh sketch's own ids still resolve.
    expectValid(
      validateSketch(
        {
          ...reuse,
          actions: [
            { atMs: 0, do: "highlight", target: { id: "t" }, durationMs: 400 },
          ],
        },
        { board: lessonBoard, fresh: true },
      ),
    );
  });
});

// The answer template's rows (ARCHITECTURE.md section 4): only a fresh sketch, the Answer
// view's drawing, is held to them.
describe("validate: a fresh sketch's answer template (#90)", () => {
  const FRESH = { board: lessonBoard, fresh: true };
  const title: BoardObject = {
    kind: "text",
    id: "title",
    x: 800,
    y: 110,
    text: "Why scale?",
  };
  const a: BoardObject = {
    kind: "matrix",
    id: "a",
    x: 300,
    y: 400,
    rows: [["1", "2"]],
    label: "raw",
  };
  const f: BoardObject = {
    kind: "latex",
    id: "f",
    x: 1100,
    y: 424,
    tex: "d_k",
  };
  const join: BoardObject = {
    kind: "arrow",
    id: "j",
    from: { id: "a" },
    to: { id: "f" },
    label: "divide",
  };
  const answer = (...objects: BoardObject[]): Sketch => ({
    objects,
    actions: [],
  });

  it("A fresh sketch laid out from the template: valid", () => {
    expectValid(validateSketch(answer(title, a, f, join), FRESH));
  });

  describe("counts: at most 8 objects besides arrows, and at most 6 arrows", () => {
    /** Small texts on a 3 x 3 grid, well apart. */
    const texts = (n: number) =>
      Array.from({ length: n }, (_, i): BoardObject => ({
        kind: "text",
        id: `t${i}`,
        x: 200 + (i % 3) * 500,
        y: 200 + Math.floor(i / 3) * 200,
        text: "x",
        size: "s",
      }));
    const arrow = (from: number, to: number): BoardObject => ({
      kind: "arrow",
      id: `r${from}_${to}`,
      from: { id: `t${from}` },
      to: { id: `t${to}` },
    });
    const sixArrows = [
      arrow(0, 1),
      arrow(1, 2),
      arrow(3, 4),
      arrow(4, 5),
      arrow(6, 7),
      arrow(0, 3),
    ];

    it("8 objects and 6 arrows: valid", () => {
      expectValid(validateSketch(answer(...texts(8), ...sixArrows), FRESH));
    });

    it("9 objects besides arrows: rejected: too many objects", () => {
      expectErrors(
        validateSketch(answer(...texts(9)), FRESH),
        errors.tooManyObjects(ANSWER_TEMPLATE.maxContent + 1),
      );
    });

    it("7 arrows: rejected: too many arrows", () => {
      expectErrors(
        validateSketch(answer(...texts(8), ...sixArrows, arrow(1, 4)), FRESH),
        errors.tooManyArrows(ANSWER_TEMPLATE.maxArrows + 1),
      );
    });
  });

  it('An object whose estimated box leaves the answer area: rejected: outside the answer area "x"', () => {
    // On the canvas (its centre is), but its box runs past the area's right edge.
    const wide: BoardObject = {
      kind: "text",
      id: "wide",
      x: 1450,
      y: 450,
      text: "a long line of words",
    };
    expectErrors(
      validateSketch(answer(wide), FRESH),
      errors.outsideAnswerArea("wide"),
    );
  });

  it('A matrix whose label rises out of the area: rejected: outside the answer area "x"', () => {
    const high: BoardObject = { ...a, y: ANSWER_TEMPLATE.area.y0 + 10 };
    expectErrors(
      validateSketch(answer(high), FRESH),
      errors.outsideAnswerArea("a"),
    );
    // Without the label, the cells and brackets fit.
    const bare = { ...high, label: undefined };
    expectValid(validateSketch(answer(bare), FRESH));
  });

  it('An arrow point, or a move to a point, outside the area: rejected: outside the answer area "x"', () => {
    const toEdge: BoardObject = {
      kind: "arrow",
      id: "edge",
      from: { id: "a" },
      to: { x: 1550, y: 450 },
    };
    expectErrors(
      validateSketch(answer(a, toEdge), FRESH),
      errors.outsideAnswerArea("edge"),
    );
    const moved: Sketch = {
      objects: [title],
      actions: [
        {
          atMs: 0,
          do: "move",
          target: { id: "title" },
          to: { x: 40, y: 450 },
          durationMs: 400,
        },
      ],
    };
    expectErrors(
      validateSketch(moved, FRESH),
      errors.outsideAnswerArea("title"),
    );
  });

  it('Two objects closer than 40 (or overlapping): soft: "a" and "b" are too close, still drawable', () => {
    const near: BoardObject = { ...f, x: 480, id: "near" };
    const r = validateSketch(answer(a, near), FRESH);
    expectErrors(r, errors.tooClose("a", "near", ANSWER_TEMPLATE.gap));
    expect(r.ok === false && r.softOnly).toEqual({
      value: answer(a, near),
      count: 1,
    });
  });

  it("Two objects an arrow joins, 40 or more apart: valid (the arrow shows in the gap)", () => {
    // About 60 apart.
    const close: BoardObject = { ...f, x: 530 };
    expectValid(validateSketch(answer(a, close, join), FRESH));
  });

  it("A spacing problem with a hard one: not drawable (no softOnly)", () => {
    const near: BoardObject = { ...f, x: 480, id: "near", tex: "x" };
    const r = validateSketch(answer(a, near, { ...title, text: "d_k" }), FRESH);
    expectErrors(
      r,
      errors.tooClose("a", "near", ANSWER_TEMPLATE.gap),
      errors.mathsInPlainText("title"),
    );
    expect(r.ok === false && r.softOnly).toBeUndefined();
  });

  it('"_" or "^" in a text, an arrow or matrix label, a matrix cell or a written value: rejected', () => {
    const cases: [Sketch, string][] = [
      [answer({ ...title, text: "d_k grows" }), "title"],
      [answer(a, f, { ...join, label: "x^2" }), "j"],
      [answer({ ...a, label: "W_Q" }), "a"],
      [answer({ ...a, rows: [["q_1", "2"]] }), "a"],
      [
        {
          objects: [title],
          actions: [
            {
              atMs: 0,
              do: "write",
              target: { id: "title" },
              value: "x^2",
              durationMs: 400,
            },
          ],
        },
        "title",
      ],
    ];
    for (const [sketch, id] of cases)
      expectErrors(validateSketch(sketch, FRESH), errors.mathsInPlainText(id));
    // Maths in a latex object is what the rule asks for.
    expectValid(validateSketch(answer(f), FRESH));
  });

  it("A sketch on the lesson board (not fresh) isn't held to the template", () => {
    const wide: BoardObject = {
      kind: "text",
      id: "wide",
      x: 1580,
      y: 20,
      text: "d_k",
    };
    expectValid(validateSketch(answer(wide), { board: lessonBoard }));
  });
});

describe("validate: the answer template (property, #90)", () => {
  const FRESH = { board: lessonBoard, fresh: true };
  const { area, content, title, takeaway, gap } = ANSWER_TEMPLATE;
  /** A plain word or number, never "_" or "^". */
  const word = fc.stringMatching(/^[a-z0-9 .]{1,12}$/);
  const cellValue = fc.stringMatching(/^[0-9.]{1,3}$/);
  const FORMULAS = [
    "x",
    "\\frac{a}{b}",
    "q\\cdot k=\\sum q_i k_i",
    "\\sqrt{d_k}",
    "e^{s_i}",
    "\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}",
  ];
  type Placed = Exclude<BoardObject, { kind: "arrow" | "image" }>;

  /** A text, formula or matrix of any size, at the origin (`id` is set when placed). */
  const contentObject: fc.Arbitrary<Placed> = fc.oneof(
    fc.record({
      kind: fc.constant("text" as const),
      id: fc.constant(""),
      x: fc.constant(0),
      y: fc.constant(0),
      text: word,
      size: fc.constantFrom("s" as const, "m" as const),
    }),
    fc.record({
      kind: fc.constant("latex" as const),
      id: fc.constant(""),
      x: fc.constant(0),
      y: fc.constant(0),
      tex: fc.constantFrom(...FORMULAS),
    }),
    fc
      .tuple(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 4 }))
      .chain(([r, c]) =>
        fc.record({
          kind: fc.constant("matrix" as const),
          id: fc.constant(""),
          x: fc.constant(0),
          y: fc.constant(0),
          rows: fc.array(fc.array(cellValue, { minLength: c, maxLength: c }), {
            minLength: r,
            maxLength: r,
          }),
          label: fc.option(word, { nil: undefined }),
        }),
      ),
  );

  /** Moves an object so its estimated box's top-left corner is at (x0, y0). */
  function placeAt<T extends Placed>(obj: T, x0: number, y0: number): T {
    const box = objectBox(obj)!;
    return { ...obj, x: obj.x + x0 - box.x0, y: obj.y + y0 - box.y0 };
  }
  const size = (obj: Placed) => {
    const b = objectBox(obj)!;
    return { w: b.x1 - b.x0, h: b.y1 - b.y0 };
  };

  /**
   * What the prompt asks for: the title and takeaway at their spots, and the content in one
   * row or column inside the content area, `gap` apart, pushed to its edges. Null when
   * the content doesn't fit in one row or column.
   */
  const layout = fc
    .record({
      items: fc.array(contentObject, { minLength: 1, maxLength: 4 }),
      titleText: word,
      takeawayText: fc.option(word, { nil: undefined }),
      direction: fc.constantFrom("row" as const, "column" as const),
      start: fc.boolean(),
      edge: fc.boolean(),
      arrows: fc.boolean(),
    })
    .map((spec): Sketch | null => {
      const sizes = spec.items.map(size);
      const along = (s: { w: number; h: number }) =>
        spec.direction === "row" ? s.w : s.h;
      const total =
        sizes.reduce((sum, s) => sum + along(s), 0) + gap * (sizes.length - 1);
      const room =
        spec.direction === "row"
          ? content.x1 - content.x0
          : content.y1 - content.y0;
      const across =
        spec.direction === "row"
          ? content.y1 - content.y0
          : content.x1 - content.x0;
      if (
        total > room ||
        sizes.some((s) => (spec.direction === "row" ? s.h : s.w) > across)
      )
        return null;
      // From the content area's start edge, or ending on its far edge.
      let at =
        (spec.direction === "row" ? content.x0 : content.y0) +
        (spec.start ? 0 : room - total);
      const items = spec.items.map((item, i) => {
        const s = sizes[i];
        // Each pushed to one side of the area, across the row or column.
        const side =
          spec.direction === "row"
            ? spec.edge
              ? content.y0
              : content.y1 - s.h
            : spec.edge
              ? content.x0
              : content.x1 - s.w;
        const placed =
          spec.direction === "row"
            ? placeAt(item, at, side)
            : placeAt(item, side, at);
        at += along(s) + gap;
        return { ...placed, id: `c${i}` };
      });
      const lines: BoardObject[] = [
        { kind: "text", id: "title", ...title, text: spec.titleText },
        ...(spec.takeawayText === undefined
          ? []
          : [
              {
                kind: "text" as const,
                id: "takeaway",
                ...takeaway,
                text: spec.takeawayText,
              },
            ]),
      ];
      const arrows: BoardObject[] = spec.arrows
        ? items.slice(1).map((item, i) => ({
            kind: "arrow",
            id: `r${i}`,
            from: { id: items[i].id },
            to: { id: item.id },
          }))
        : [];
      return { objects: [...lines, ...items, ...arrows], actions: [] };
    });

  it("a layout that follows the template, any kinds and sizes pushed to the content area's edges, is valid", () => {
    fc.assert(
      fc.property(layout, (sketch) => {
        fc.pre(sketch !== null);
        expectValid(validateSketch(sketch!, FRESH));
      }),
    );
  });

  it("pushing any content object past the answer area is rejected, naming it", () => {
    fc.assert(
      fc.property(
        layout,
        fc.nat(),
        fc.constantFrom("left", "right", "up", "down"),
        fc.integer({ min: 1, max: 300 }),
        (sketch, pick, side, by) => {
          fc.pre(sketch !== null);
          const items = sketch!.objects.filter((o): o is Placed =>
            o.id.startsWith("c"),
          );
          const moved = items[pick % items.length];
          const s = size(moved);
          const x0 =
            side === "left"
              ? area.x0 - by
              : side === "right"
                ? area.x1 + by - s.w
                : objectBox(moved)!.x0;
          const y0 =
            side === "up"
              ? area.y0 - by
              : side === "down"
                ? area.y1 + by - s.h
                : objectBox(moved)!.y0;
          const objects = sketch!.objects.map((o) =>
            o.id === moved.id ? placeAt(moved, x0, y0) : o,
          );
          expectErrors(
            validateSketch({ ...sketch!, objects }, FRESH),
            errors.outsideAnswerArea(moved.id),
          );
        },
      ),
    );
  });

  it("two objects whose estimated boxes overlap are always too close", () => {
    fc.assert(
      fc.property(
        contentObject,
        contentObject,
        fc.double({ min: 0, max: 0.99, noNaN: true }),
        fc.double({ min: 0, max: 0.99, noNaN: true }),
        (p, q, fx, fy) => {
          const first = { ...placeAt(p, 500, 400), id: "p" };
          const box = objectBox(first)!;
          const second = {
            ...placeAt(
              q,
              box.x0 + fx * (box.x1 - box.x0),
              box.y0 + fy * (box.y1 - box.y0),
            ),
            id: "q",
          };
          expectErrors(
            validateSketch({ objects: [first, second], actions: [] }, FRESH),
            errors.tooClose("p", "q", gap),
          );
        },
      ),
    );
  });

  it('any text with "_" or "^" in it is always rejected', () => {
    fc.assert(
      fc.property(
        word,
        fc.constantFrom("_", "^"),
        word,
        (before, mark, after) => {
          const sketch = answer(`${before}${mark}${after}`);
          expectErrors(
            validateSketch(sketch, FRESH),
            errors.mathsInPlainText("t"),
          );
        },
      ),
    );
    function answer(text: string): Sketch {
      return {
        objects: [{ kind: "text", id: "t", x: 800, y: 450, text, size: "s" }],
        actions: [],
      };
    }
  });
});

describe("boxGap (property)", () => {
  const box = fc
    .record({
      x0: fc.integer({ min: -500, max: 2000 }),
      y0: fc.integer({ min: -500, max: 2000 }),
      w: fc.integer({ min: 1, max: 800 }),
      h: fc.integer({ min: 1, max: 800 }),
    })
    .map(({ x0, y0, w, h }) => ({ x0, y0, x1: x0 + w, y1: y0 + h }));
  const overlap = (a: Box, b: Box) =>
    a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

  it("is symmetric", () => {
    fc.assert(
      fc.property(box, box, (a, b) => {
        expect(boxGap(a, b)).toBe(boxGap(b, a));
      }),
    );
  });

  it("is at least 0 exactly when the boxes don't overlap", () => {
    fc.assert(
      fc.property(box, box, (a, b) => {
        expect(boxGap(a, b) >= 0).toBe(!overlap(a, b));
      }),
    );
  });

  it("is the distance between two boxes side by side", () => {
    fc.assert(
      fc.property(box, fc.integer({ min: 0, max: 500 }), (a, d) => {
        const b = { ...a, x0: a.x1 + d, x1: a.x1 + d + (a.x1 - a.x0) };
        expect(boxGap(a, b)).toBe(d);
      }),
    );
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
