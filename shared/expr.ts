// The widget expression language (issue #110): a whitelisted arithmetic parser, so a model's
// formula is data the browser evaluates, never code it runs. No eval, no Function: the source
// is tokenized, parsed by recursive descent into a small tree, and the tree is walked. Bounded:
// at most MAX_EXPR_CHARS characters and MAX_EXPR_DEPTH levels of nesting. Pure, no node-only
// imports: the server validates with it and the browser evaluates with it.
//
//   expr    = term (("+" | "-") term)*
//   term    = unary (("*" | "/") unary)*
//   unary   = "-" unary | power
//   power   = primary ("^" unary)?          (right-associative: 2^3^2 = 2^9; -x^2 = -(x^2))
//   primary = number | name | fn "(" expr ("," expr)* ")" | "(" expr ")"
//
// Names are `x`, the declared parameters, and the constants `pi` and `e`.

export const MAX_EXPR_CHARS = 200;
export const MAX_EXPR_DEPTH = 32;

/** One-argument functions, and the two that take two or more. */
const UNARY = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  exp: Math.exp,
  log: Math.log,
  sqrt: Math.sqrt,
  abs: Math.abs,
  tanh: Math.tanh,
} as const;
const VARIADIC = { min: Math.min, max: Math.max } as const;
const CONSTANTS = { pi: Math.PI, e: Math.E } as const;

export type FnName = keyof typeof UNARY | keyof typeof VARIADIC;
export const FUNCTIONS: readonly FnName[] = [
  ...(Object.keys(UNARY) as (keyof typeof UNARY)[]),
  ...(Object.keys(VARIADIC) as (keyof typeof VARIADIC)[]),
];
/** Names a parameter can't take: the variable, the constants and the functions. */
export const RESERVED_NAMES: readonly string[] = [
  "x",
  ...Object.keys(CONSTANTS),
  ...FUNCTIONS,
];

/** Why an expression was refused. The only error the parser throws, and it never escapes `compile`. */
export class ExprError extends Error {}

export type Expr =
  | { k: "num"; v: number }
  | { k: "name"; name: string }
  | { k: "neg"; a: Expr }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Expr; b: Expr }
  | { k: "call"; fn: FnName; args: Expr[] };

type Token =
  | { t: "num"; v: number; at: number }
  | { t: "name"; name: string; at: number }
  | { t: "op"; op: string; at: number }
  | { t: "end"; at: number };

const NUMBER_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const rest = src.slice(i);
    const num = NUMBER_RE.exec(rest);
    if (num) {
      out.push({ t: "num", v: Number(num[0]), at: i });
      i += num[0].length;
      continue;
    }
    const name = NAME_RE.exec(rest);
    if (name) {
      out.push({ t: "name", name: name[0], at: i });
      i += name[0].length;
      continue;
    }
    if ("+-*/^(),".includes(ch)) {
      out.push({ t: "op", op: ch, at: i });
      i++;
      continue;
    }
    throw new ExprError(`unexpected character "${ch}"`);
  }
  out.push({ t: "end", at: src.length });
  return out;
}

function describe(tok: Token): string {
  switch (tok.t) {
    case "num":
      return `number ${tok.v}`;
    case "name":
      return `"${tok.name}"`;
    case "op":
      return `"${tok.op}"`;
    case "end":
      return "the end";
  }
}

function isFn(name: string): name is FnName {
  return Object.hasOwn(UNARY, name) || Object.hasOwn(VARIADIC, name);
}

/**
 * Parses `src` into a tree whose names are all in `names` (or constants). Throws ExprError,
 * and only ExprError, when it can't.
 */
export function parseExpr(src: string, names: readonly string[]): Expr {
  if (src.length > MAX_EXPR_CHARS)
    throw new ExprError(`longer than ${MAX_EXPR_CHARS} characters`);
  if (src.trim() === "") throw new ExprError("empty");
  const toks = tokenize(src);
  const known = new Set(names);
  let pos = 0;
  let depth = 0;
  const peek = () => toks[pos];
  const isOp = (op: string) => {
    const tok = toks[pos];
    return tok.t === "op" && tok.op === op;
  };
  const expect = (op: string) => {
    if (!isOp(op))
      throw new ExprError(`expected "${op}", found ${describe(peek())}`);
    pos++;
  };
  const nest = <T>(f: () => T): T => {
    if (++depth > MAX_EXPR_DEPTH)
      throw new ExprError(`nested deeper than ${MAX_EXPR_DEPTH}`);
    const v = f();
    depth--;
    return v;
  };

  const expr = (): Expr =>
    nest(() => {
      let a = term();
      while (isOp("+") || isOp("-")) {
        const op = (toks[pos++] as { op: "+" | "-" }).op;
        a = { k: "bin", op, a, b: term() };
      }
      return a;
    });
  const term = (): Expr => {
    let a = unary();
    while (isOp("*") || isOp("/")) {
      const op = (toks[pos++] as { op: "*" | "/" }).op;
      a = { k: "bin", op, a, b: unary() };
    }
    return a;
  };
  const unary = (): Expr =>
    nest(() => {
      if (isOp("-")) {
        pos++;
        return { k: "neg", a: unary() };
      }
      return power();
    });
  const power = (): Expr => {
    const a = primary();
    if (isOp("^")) {
      pos++;
      return { k: "bin", op: "^", a, b: unary() };
    }
    return a;
  };
  const primary = (): Expr => {
    const tok = peek();
    if (tok.t === "num") {
      pos++;
      return { k: "num", v: tok.v };
    }
    if (tok.t === "name") {
      pos++;
      if (isFn(tok.name)) {
        if (!isOp("(")) throw new ExprError(`"${tok.name}" needs ( ) after it`);
        pos++;
        const args = [expr()];
        while (isOp(",")) {
          pos++;
          args.push(expr());
        }
        expect(")");
        const variadic = Object.hasOwn(VARIADIC, tok.name);
        if (variadic ? args.length < 2 : args.length !== 1)
          throw new ExprError(
            `"${tok.name}" takes ${variadic ? "two or more arguments" : "one argument"}`,
          );
        return { k: "call", fn: tok.name, args };
      }
      if (Object.hasOwn(CONSTANTS, tok.name) || known.has(tok.name))
        return { k: "name", name: tok.name };
      throw new ExprError(`unknown name "${tok.name}"`);
    }
    if (isOp("(")) {
      pos++;
      const inner = expr();
      expect(")");
      return inner;
    }
    throw new ExprError(
      `expected a number, a name or "(", found ${describe(tok)}`,
    );
  };

  const tree = expr();
  if (peek().t !== "end")
    throw new ExprError(`expected an operator, found ${describe(peek())}`);
  return tree;
}

/** Values for an expression's names. Constants are built in. */
export type ExprEnv = Readonly<Record<string, number>>;

function binOp(op: "+" | "-" | "*" | "/" | "^", a: number, b: number): number {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return a / b;
    case "^":
      return a ** b;
  }
}

/** Evaluates a parsed tree. A name missing from `env` is NaN (parseExpr already refused it). */
export function evalExpr(e: Expr, env: ExprEnv): number {
  switch (e.k) {
    case "num":
      return e.v;
    case "name":
      if (Object.hasOwn(CONSTANTS, e.name))
        return CONSTANTS[e.name as keyof typeof CONSTANTS];
      return Object.hasOwn(env, e.name) ? env[e.name] : NaN;
    case "neg":
      return -evalExpr(e.a, env);
    case "bin":
      return binOp(e.op, evalExpr(e.a, env), evalExpr(e.b, env));
    case "call": {
      const args = e.args.map((a) => evalExpr(a, env));
      if (Object.hasOwn(VARIADIC, e.fn))
        return VARIADIC[e.fn as keyof typeof VARIADIC](...args);
      return UNARY[e.fn as keyof typeof UNARY](args[0]);
    }
  }
}

export type Compiled =
  | { ok: true; expr: Expr; evaluate: (env: ExprEnv) => number }
  | { ok: false; error: string };

/** Parses `src` over `names` once; the result evaluates it for any values of them. */
export function compileExpr(src: string, names: readonly string[]): Compiled {
  try {
    const expr = parseExpr(src, names);
    return { ok: true, expr, evaluate: (env) => evalExpr(expr, env) };
  } catch (err) {
    if (err instanceof ExprError) return { ok: false, error: err.message };
    throw err;
  }
}
