// The widget expression parser (issue #110, shared/expr.ts): what it accepts, how it
// evaluates, the named errors it refuses with, and property tests that it never throws
// outside ExprError, never reads a name it wasn't given, and stays bounded.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  compileExpr,
  evalExpr,
  ExprError,
  FUNCTIONS,
  MAX_EXPR_CHARS,
  MAX_EXPR_DEPTH,
  parseExpr,
} from "@/shared/expr";

const NAMES = ["x", "a", "b"];
const value = (src: string, env: Record<string, number> = {}) => {
  const c = compileExpr(src, NAMES);
  if (!c.ok) throw new Error(c.error);
  return c.evaluate({ x: 0, a: 0, b: 0, ...env });
};
const errorOf = (src: string, names = NAMES) => {
  const c = compileExpr(src, names);
  return c.ok ? undefined : c.error;
};

describe("evaluation", () => {
  it("numbers, + - * / ^, parentheses and unary minus, with the usual precedence", () => {
    expect(value("1 + 2 * 3")).toBe(7);
    expect(value("(1 + 2) * 3")).toBe(9);
    expect(value("2 ^ 3 ^ 2")).toBe(512); // right-associative
    expect(value("-x^2", { x: 3 })).toBe(-9); // -(x^2)
    expect(value("2^-1")).toBe(0.5);
    expect(value("--3")).toBe(3);
    expect(value("10 / 4 - 1.5e1 + .5")).toBe(-12);
  });

  it("x, the declared params and the constants pi and e", () => {
    expect(value("a * x + b", { a: 2, x: 3, b: 1 })).toBe(7);
    expect(value("pi")).toBe(Math.PI);
    expect(value("e")).toBe(Math.E);
  });

  it("every whitelisted function", () => {
    expect(value("sin(0) + cos(0) + tan(0)")).toBe(1);
    expect(value("exp(0) + log(1) + sqrt(4) + abs(-2) + tanh(0)")).toBe(5);
    expect(value("min(3, 1, 2) + max(1, 5)")).toBe(6);
    expect(FUNCTIONS).toEqual([
      "sin",
      "cos",
      "tan",
      "exp",
      "log",
      "sqrt",
      "abs",
      "tanh",
      "min",
      "max",
    ]);
  });

  it("NaN and Infinity come out as numbers, never errors (the renderer skips them)", () => {
    expect(value("log(x)", { x: -1 })).toBeNaN();
    expect(value("1 / x", { x: 0 })).toBe(Infinity);
  });
});

describe("named errors", () => {
  it.each([
    ["y * 2", 'unknown name "y"'],
    ["foo(x)", 'unknown name "foo"'],
    ["sin x", '"sin" needs ( ) after it'],
    ["sin(x, x)", '"sin" takes one argument'],
    ["max(x)", '"max" takes two or more arguments'],
    ["2 x", 'expected an operator, found "x"'],
    ["(x + 1", 'expected ")", found the end'],
    ["x +", 'expected a number, a name or "(", found the end'],
    ["x; alert(1)", 'unexpected character ";"'],
    ["x.constructor", 'unexpected character "."'],
    ["", "empty"],
    [
      "x".repeat(MAX_EXPR_CHARS + 1),
      `longer than ${MAX_EXPR_CHARS} characters`,
    ],
    [
      "(".repeat(MAX_EXPR_DEPTH + 1) + "x" + ")".repeat(MAX_EXPR_DEPTH + 1),
      `nested deeper than ${MAX_EXPR_DEPTH}`,
    ],
  ])("%s -> %s", (src, error) => {
    expect(errorOf(src)).toBe(error);
  });

  it("property-like names are unknown names, not lookups (no prototype access)", () => {
    for (const name of ["constructor", "__proto__", "toString", "valueOf"])
      expect(errorOf(`${name}(x)`)).toBe(`unknown name "${name}"`);
    expect(errorOf("constructor")).toBe('unknown name "constructor"');
  });
});

// ------------------------------------------------------------ properties

/** Source text for a random well-formed expression over `names`. */
const exprSrc = (names: readonly string[]) =>
  fc.letrec<{ e: string }>((tie) => ({
    e: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      fc.integer({ min: 0, max: 99 }).map(String),
      fc.constantFrom(...names, "pi", "e"),
      tie("e").map((a) => `-(${a})`),
      fc
        .tuple(tie("e"), fc.constantFrom("+", "-", "*", "/", "^"), tie("e"))
        .map(([a, op, b]) => `(${a}) ${op} (${b})`),
      fc
        .tuple(
          fc.constantFrom("sin", "cos", "exp", "log", "sqrt", "abs", "tanh"),
          tie("e"),
        )
        .map(([f, a]) => `${f}(${a})`),
      fc.tuple(tie("e"), tie("e")).map(([a, b]) => `max(${a}, ${b})`),
    ),
  })).e;

describe("properties", () => {
  it("any input string: compileExpr returns ok or an error, and throws nothing", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 260 }), (src) => {
        const c = compileExpr(src, NAMES);
        expect(typeof c.ok).toBe("boolean");
      }),
      { numRuns: 2000 },
    );
  });

  it("any input built from the language's own characters: still only ExprError", () => {
    const alphabet = fc.constantFrom(
      ..."xab()+-*/^,. 0123456789eEpisnoctaqrlgmhd_".split(""),
    );
    fc.assert(
      fc.property(fc.array(alphabet, { maxLength: 240 }), (chars) => {
        try {
          parseExpr(chars.join(""), NAMES);
        } catch (err) {
          expect(err).toBeInstanceOf(ExprError);
        }
      }),
      { numRuns: 3000 },
    );
  });

  it("an expression that parses reads only the names it was given", () => {
    fc.assert(
      fc.property(exprSrc(NAMES), (src) => {
        const c = compileExpr(src, NAMES);
        if (!c.ok) return; // e.g. too long
        const read = new Set<string>();
        const env = new Proxy({ x: 1, a: 2, b: 3 } as Record<string, number>, {
          get(target, key) {
            read.add(String(key));
            return target[key as string];
          },
          has(target, key) {
            read.add(String(key));
            return key in target;
          },
          getOwnPropertyDescriptor(target, key) {
            read.add(String(key));
            return Object.getOwnPropertyDescriptor(target, key);
          },
        });
        const v = c.evaluate(env);
        expect(typeof v).toBe("number");
        for (const name of read) expect(NAMES).toContain(name);
      }),
      { numRuns: 1000 },
    );
  });

  it("a name that wasn't declared is always refused by name", () => {
    const undeclared = fc
      .stringMatching(/^[a-z][a-z0-9_]{0,8}$/)
      .filter(
        (n) =>
          !NAMES.includes(n) &&
          !["pi", "e"].includes(n) &&
          !(FUNCTIONS as readonly string[]).includes(n),
      );
    fc.assert(
      fc.property(exprSrc(NAMES), undeclared, (src, name) => {
        const c = compileExpr(`(${src}) + ${name}`, NAMES);
        if (c.ok) throw new Error(`accepted undeclared "${name}"`);
        expect(c.error).toMatch(/unknown name|longer than|nested deeper/);
      }),
      { numRuns: 500 },
    );
  });

  it("bounded: any nesting depth or length is refused quickly, with no stack overflow", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), (depth) => {
        const src = "(".repeat(depth) + "x" + ")".repeat(depth);
        const c = compileExpr(src, NAMES);
        if (src.length > MAX_EXPR_CHARS || depth >= MAX_EXPR_DEPTH)
          expect(c.ok).toBe(false);
      }),
      { numRuns: 200 },
    );
    const start = performance.now();
    compileExpr("-".repeat(10_000) + "x", NAMES);
    compileExpr("x+".repeat(5_000) + "x", NAMES);
    expect(performance.now() - start).toBeLessThan(200);
  });

  it("a parsed tree evaluates the same as its source parsed again (pure, deterministic)", () => {
    fc.assert(
      fc.property(exprSrc(NAMES), (src) => {
        const c = compileExpr(src, NAMES);
        if (!c.ok) return;
        const env = { x: 0.5, a: -1.25, b: 2 };
        expect(
          Object.is(c.evaluate(env), evalExpr(parseExpr(src, NAMES), env)),
        ).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
