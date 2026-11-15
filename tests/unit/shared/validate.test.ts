// One test per row of the ARCHITECTURE.md section 4 validation table, named
// after the row, plus the M1 demo fixture as the contract's acceptance test.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import demoM1 from "@/lib/fakes/fixtures/demo-m1.step.json";
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

  it("More than 8 objects: rejected: too many objects", () => {
    const many = Array.from(
      { length: ANSWER_TEMPLATE.maxObjects + 1 },
      (_, i): BoardObject => ({
        kind: "text",
        id: `t${i}`,
        x: 200 + (i % 3) * 500,
        y: 200 + Math.floor(i / 3) * 200,
        text: "x",
        size: "s",
      }),
    );
    expectErrors(
      validateSketch(answer(...many), FRESH),
      errors.tooManyObjects(ANSWER_TEMPLATE.maxObjects + 1),
    );
    expectValid(validateSketch(answer(...many.slice(1)), FRESH));
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

  it('Two objects closer than 40 (or overlapping): rejected: "a" and "b" are too close', () => {
    const near: BoardObject = { ...f, x: 480, id: "near" };
    expectErrors(
      validateSketch(answer(a, near), FRESH),
      errors.tooClose("a", "near", ANSWER_TEMPLATE.gap),
    );
  });

  it("Two objects an arrow joins, closer than 80: rejected: too close (leave 80)", () => {
    // About 60 apart: enough for two objects, not for an arrow between them.
    const close: BoardObject = { ...f, x: 530 };
    expectValid(validateSketch(answer(a, close), FRESH));
    expectErrors(
      validateSketch(answer(a, close, join), FRESH),
      errors.tooClose("a", "f", ANSWER_TEMPLATE.arrowGap),
    );
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
  /** A plain word or number, never "_" or "^". */
  const word = fc.stringMatching(/^[a-z0-9 .]{1,12}$/);
  /** Up to 8 small texts in a grid of slots, each inside the content area. */
  const laidOut = fc
    .uniqueArray(fc.integer({ min: 0, max: 11 }), {
      minLength: 1,
      maxLength: ANSWER_TEMPLATE.maxObjects,
    })
    .chain((slots) =>
      fc.tuple(
        fc.constant(slots),
        fc.array(word, { minLength: slots.length, maxLength: slots.length }),
      ),
    )
    .map(([slots, words]): Sketch => ({
      objects: slots.map((slot, i) => ({
        kind: "text",
        id: `t${i}`,
        x: 350 + (slot % 4) * 300,
        y: 250 + Math.floor(slot / 4) * 200,
        text: words[i],
        size: "s",
      })),
      actions: [],
    }));

  it("any answer laid out in the template's grid with plain words is valid", () => {
    fc.assert(
      fc.property(laidOut, (sketch) => {
        expectValid(validateSketch(sketch, FRESH));
      }),
    );
  });

  it("moving any one object's centre off the area is always rejected, naming it", () => {
    fc.assert(
      fc.property(
        laidOut,
        fc.nat(),
        fc.constantFrom("left", "right", "up", "down"),
        (sketch, pick, side) => {
          const i = pick % sketch.objects.length;
          const { area } = ANSWER_TEMPLATE;
          const objects = sketch.objects.map((o, j) =>
            j !== i || o.kind !== "text"
              ? o
              : {
                  ...o,
                  x:
                    side === "left"
                      ? area.x0
                      : side === "right"
                        ? area.x1
                        : o.x,
                  y: side === "up" ? area.y0 : side === "down" ? area.y1 : o.y,
                },
          );
          expectErrors(
            validateSketch({ ...sketch, objects }, FRESH),
            errors.outsideAnswerArea(`t${i}`),
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
