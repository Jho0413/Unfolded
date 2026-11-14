// Spike S3 (issue #11, ARCHITECTURE.md section 11): does Sonnet 5.5 write valid Step scripts
// from a paper, and at which effort? Also settles issue #27: does the API accept the
// structured-output schema zodOutputFormat(Step) / zodOutputFormat(Sketch) builds?
//
// Real API calls, so it costs money: run it by hand, never in CI or tests.
//   npm run spike:s3 -- --probe
//   npm run spike:s3 -- --paper attention=/tmp/papers/attention.pdf \
//     --paper newton3p=/tmp/papers/newton3p.pdf --effort low,medium --fixtures medium
// --schema picks the output schema (SCHEMA_VARIANTS); the default is one-action, because
// the API rejects the contract's own schema (issue #27). The key is read from .env only.
// The concepts per paper come from scripts/s3-spike.lessons.json (paper-specific content
// lives in data, never in the prompt). Results go to evidence/s3/ (gitignored); with
// --fixtures <effort>, the valid steps of that effort go to lib/fakes/fixtures/.
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, parseEnv } from "node:util";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { config, type Effort } from "@/lib/config";
import {
  CANVAS,
  CELL,
  MAX_DURATION_MS,
  MAX_MATRIX_DIM,
  Sketch,
  Step,
} from "@/shared/scene";
import { validateStep } from "@/shared/validate";

const EFFORTS = ["low", "medium", "high"] as const satisfies Effort[];
const MAX_TOKENS = 32000;
const LIMITS = { maxNarrationChars: config.maxNarrationChars };

// The step system prompt: generic (no paper, no concept), and byte-identical for every
// step so the cached prefix (system + paper) is reused (ARCHITECTURE.md section 5.1).
const SYSTEM = `You write one step of a narrated whiteboard lesson about the attached paper. The learner hears the narration while the board animates in sync with it. Your output is a JSON object with title, narration, objects and actions.

The board
- A ${CANVAS.w} x ${CANVAS.h} canvas, origin top-left, y grows downward. Every object must be inside it.
- matrix: x,y is the top-left corner of its cell box. Every cell is ${CELL.w} wide and ${CELL.h} tall, so a matrix with R rows and C columns covers x..x+${CELL.w}*C, y..y+${CELL.h}*R. 1 to ${MAX_MATRIX_DIM} rows and columns; every row has the same length; cells are short strings ("" is empty). The optional label is drawn above it.
- text: x,y is the centre. size "s", "m" or "l". Plain text only: a text object shows a backslash or ^ literally, so every formula goes in a latex object.
- latex: x,y is the centre. tex is KaTeX math (no $ delimiters, no \\begin{document}, no \\href or \\url).
- arrow: from and to are anchors. An anchor is a target (an object id, optionally with row/col of a matrix) or a point {x, y}. An arrow end can never name an arrow.
- image: leave images out.
- hidden: true keeps an object off the board until a show action reveals it. Use it to build the board up as the narration goes.
- Lay objects out so they don't overlap: leave room for matrices to grow, and keep text away from matrix cells.

Ids and targets
- Every id is unique and matches ^[a-z][a-z0-9_]{0,31}$.
- A target is {id}, or a matrix row {id, row}, column {id, col} or cell {id, row, col}, 0-based and inside the matrix. Only matrices take row or col.

Actions (each has a cue, and durationMs from 0 to ${MAX_DURATION_MS})
- show / hide: a whole object (no row or col). hide on a moved matrix part removes its copy.
- highlight / unhighlight: an object, or a matrix row, column or cell. color "accent" or "warn".
- move: the target's centre slides to the anchor. Moving a matrix row, column or cell slides a copy and leaves the matrix whole. Arrows can't move.
- write: replace the value of a matrix cell (needs both row and col) or the text of a text object. Never write to latex or arrows.

Narration and cues
- Plain spoken English, as a friendly teacher would say it aloud: no markdown, no LaTeX, no maths symbols. Spell maths out in words, since the voice skips or misreads symbols: "a times b", "x squared", "the square root of n".
- The narration is the final script: never correct yourself or think aloud in it.
- At most ${config.maxNarrationChars} characters once markers are removed; aim for 60 to 90 seconds of speech.
- Put a cue marker [[name]] right before the word where an action should fire. name matches ^[a-z][a-z0-9_]{0,31}$, and each marker appears once. Never write [[ or ]] for anything else.
- Every action's cue must be a marker in the narration. Several actions may share one cue; they fire together.

Teach the step's goal with a small concrete worked example on the board (small matrices, round numbers), grounded in the paper's own notation. Work out every number before you write the step, and check that the board and the narration agree.`;

interface Concept {
  slug: string;
  goal: string;
}
interface Paper {
  slug: string;
  title: string;
  concepts: Concept[];
}

/** One request: a first try or the retry with the validation errors. */
interface Attempt {
  /** The SCHEMA_VARIANTS entry the request used. */
  schema: string;
  paper: string;
  concept: string;
  effort: Effort;
  attempt: 1 | 2;
  ok: boolean;
  errors: string[];
  stopReason: string | null;
  latencyMs: number;
  usage: {
    input: number;
    cacheWrite: number;
    cacheRead: number;
    output: number;
  };
  step?: unknown;
}

let client: Anthropic;

type Json = Record<string, unknown>;

/** Every JSON object in a schema, $defs included. */
function eachObject(node: unknown, f: (o: Json) => void) {
  if (!node || typeof node !== "object") return;
  f(node as Json);
  for (const v of Object.values(node)) eachObject(v, f);
}

/** Lists every property of every object in `required`. */
const requireAll = (schema: Json) =>
  eachObject(schema, (o) => {
    if (o.properties) o.required = Object.keys(o.properties as Json);
  });

type Branch = {
  properties: Json & { do: { const: string } };
  required: string[];
};
const actionBranches = (schema: Json) =>
  ((schema.properties as Json).actions as { items: { anyOf: Branch[] } }).items
    .anyOf;

/** Folds the action union into one object: `do` is an enum, fields not in every branch optional. */
const oneAction = (schema: Json) => {
  const branches = actionBranches(schema);
  const properties: Json = Object.assign(
    {},
    ...branches.map((b) => b.properties),
  );
  properties.do = { enum: branches.map((b) => b.properties.do.const) };
  const required = branches[0].required.filter((k) =>
    branches.every((b) => b.required.includes(k)),
  );
  const actions = (schema.properties as Json).actions as Json;
  actions.items = {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
};

/** Merges two action branches with the same fields into one, `do` an enum of both. */
const mergeActions = (schema: Json, a: string, b: string) => {
  const branches = actionBranches(schema);
  const i = branches.findIndex((x) => x.properties.do.const === a);
  const j = branches.findIndex((x) => x.properties.do.const === b);
  if (i < 0 || j < 0) throw new Error(`no action branch "${a}" or "${b}"`);
  branches[i].properties.do = { enum: [a, b] } as never;
  branches.splice(j, 1);
};

/** Drops one object kind from the board-object union. */
const dropKind = (schema: Json, kind: string) => {
  const objects = (schema.properties as Json).objects as {
    items: { anyOf: { properties: { kind: unknown } }[] };
  };
  const all = objects.items.anyOf;
  const i = all.findIndex((o) =>
    JSON.stringify(o.properties.kind).includes(kind),
  );
  if (i < 0) throw new Error(`no object kind "${kind}"`);
  all.splice(i, 1);
};

/**
 * Issue #27: the contract and candidate fixes, as edits to the JSON schema the SDK sends.
 * Outputs are still checked against the real contract (validateStep).
 */
const SCHEMA_VARIANTS: Record<string, (schema: Json) => void> = {
  /** The contract as zodOutputFormat sends it. */
  contract: () => {},
  /** Diagnostic: no optional properties at all (shows optional count isn't the cause). */
  "required-all": requireAll,
  /** One action object, `do` an enum; color, to and value optional (validate checks them). */
  "one-action": oneAction,
  /** show|hide and highlight|unhighlight each one branch, and no image kind (E1 is stretch). */
  "four-actions-no-image": (schema) => {
    mergeActions(schema, "show", "hide");
    mergeActions(schema, "highlight", "unhighlight");
    dropKind(schema, "image");
  },
};

/** The JSON-schema output format the SDK sends, without its zod parse: we validate ourselves. */
function outputFormat(schema: typeof Step | typeof Sketch, variant: string) {
  const edit = SCHEMA_VARIANTS[variant];
  if (!edit) throw new Error(`unknown schema variant: ${variant}`);
  const { type, schema: json } = zodOutputFormat(schema);
  const copy = structuredClone(json) as Json;
  edit(copy);
  return { type, schema: copy };
}

/** Optional properties in a JSON schema, counted once per definition and once per use. */
function countOptional(schema: unknown): { perDef: number; perUse: number } {
  const defs = (schema as { $defs?: Record<string, unknown> }).$defs ?? {};
  // followRefs: count a $defs entry at each $ref to it (and skip $defs itself).
  const walk = (node: unknown, followRefs: boolean, seen: string[]): number => {
    if (!node || typeof node !== "object") return 0;
    const n = node as Record<string, unknown>;
    if (followRefs && typeof n.$ref === "string") {
      const name = n.$ref.replace("#/$defs/", "");
      return seen.includes(name)
        ? 0
        : walk(defs[name], followRefs, [...seen, name]);
    }
    let count = 0;
    if (n.properties && typeof n.properties === "object") {
      const required = new Set((n.required as string[] | undefined) ?? []);
      count += Object.keys(n.properties).filter((k) => !required.has(k)).length;
    }
    for (const [k, v] of Object.entries(n)) {
      if (followRefs && k === "$defs") continue;
      if (Array.isArray(v))
        count += v.reduce((s: number, x) => s + walk(x, followRefs, seen), 0);
      else count += walk(v, followRefs, seen);
    }
    return count;
  };
  return { perDef: walk(schema, false, []), perUse: walk(schema, true, []) };
}

/** Issue #27: one tiny real request per schema and variant. Accepted, or the API's 400. */
async function probe() {
  for (const variant of Object.keys(SCHEMA_VARIANTS))
    for (const [name, schema] of [
      ["Step", Step],
      ["Sketch", Sketch],
    ] as const) {
      const format = outputFormat(schema, variant);
      const counts = countOptional(format.schema);
      const label = `${name} ${variant} (optional properties: ${counts.perDef} per definition, ${counts.perUse} per use)`;
      try {
        // Only acceptance matters, so the output is capped: a rejection costs nothing.
        const msg = await client.messages.create({
          model: config.models.step,
          max_tokens: 64,
          output_config: { effort: "low", format },
          messages: [{ role: "user", content: "Draw a 2x2 identity matrix." }],
        });
        console.log(`${label}: accepted (stop ${msg.stop_reason})`);
      } catch (err) {
        if (!(err instanceof Anthropic.BadRequestError)) throw err;
        console.log(`${label}: 400 ${err.message}`);
      }
    }
}

function userText(paper: Paper, i: number): string {
  const c = paper.concepts[i];
  const previous =
    i === 0 ? "none (this is the first step)" : paper.concepts[i - 1].goal;
  return `Step ${i + 1} of ${paper.concepts.length}.\nThe previous step's goal: ${previous}\nThis step's goal: ${c.goal}`;
}

async function runStep(
  paper: Paper,
  i: number,
  fileId: string,
  effort: Effort,
  variant: string,
): Promise<Attempt[]> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        {
          type: "document",
          source: { type: "file", file_id: fileId },
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
        { type: "text", text: userText(paper, i) },
      ],
    },
  ];
  const attempts: Attempt[] = [];
  for (const attempt of [1, 2] as const) {
    const started = Date.now();
    let msg: Anthropic.Message;
    try {
      msg = await client.messages
        .stream({
          model: config.models.step,
          max_tokens: MAX_TOKENS,
          system: SYSTEM,
          output_config: { effort, format: outputFormat(Step, variant) },
          messages,
        })
        .finalMessage();
    } catch (err) {
      // The SDK has already retried; record the failure so the paid results still get saved.
      if (!(err instanceof Anthropic.APIError)) throw err;
      console.log(
        `${paper.slug}/${paper.concepts[i].slug} ${effort} try ${attempt}: request failed: ${err.message}`,
      );
      attempts.push({
        schema: variant,
        paper: paper.slug,
        concept: paper.concepts[i].slug,
        effort,
        attempt,
        ok: false,
        errors: [`request failed: ${err.message}`],
        stopReason: null,
        latencyMs: Date.now() - started,
        usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
      });
      break;
    }
    const latencyMs = Date.now() - started;
    const text = msg.content.find((b) => b.type === "text")?.text ?? "";
    let result: ReturnType<typeof validateStep>;
    try {
      result = validateStep(JSON.parse(text), LIMITS);
    } catch (err) {
      result = { ok: false, errors: [`not JSON: ${String(err)}`] };
    }
    const a: Attempt = {
      schema: variant,
      paper: paper.slug,
      concept: paper.concepts[i].slug,
      effort,
      attempt,
      ok: result.ok,
      errors: result.ok ? [] : result.errors,
      stopReason: msg.stop_reason,
      latencyMs,
      usage: {
        input: msg.usage.input_tokens,
        cacheWrite: msg.usage.cache_creation_input_tokens ?? 0,
        cacheRead: msg.usage.cache_read_input_tokens ?? 0,
        output: msg.usage.output_tokens,
      },
      step: result.ok ? result.value : safeJson(text),
    };
    attempts.push(a);
    console.log(
      `${a.paper}/${a.concept} ${effort} try ${attempt}: ${a.ok ? "valid" : `rejected: ${a.errors.join("; ")}`} (${latencyMs} ms, out ${a.usage.output}, cache r/w ${a.usage.cacheRead}/${a.usage.cacheWrite})`,
    );
    if (result.ok || msg.stop_reason === "refusal") break;
    // Retry once with the errors (ARCHITECTURE.md section 4), as G1 will.
    messages.push(
      { role: "assistant", content: msg.content },
      {
        role: "user",
        content: `That step was rejected:\n${a.errors.map((e) => `- ${e}`).join("\n")}\nWrite the whole step again with these fixed.`,
      },
    );
  }
  return attempts;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  // Only .env counts: the key and the host are passed explicitly, so the SDK never uses a
  // shell ANTHROPIC_API_KEY or ANTHROPIC_BASE_URL, or an `ant` login profile.
  const apiKey = parseEnv(readFileSync(".env", "utf8")).ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in .env");
  client = new Anthropic({ apiKey, baseURL: "https://api.anthropic.com" });
  const { values } = parseArgs({
    options: {
      probe: { type: "boolean", default: false },
      paper: { type: "string", multiple: true, default: [] },
      effort: { type: "string", default: "low,medium" },
      fixtures: { type: "string" },
      schema: { type: "string", default: "one-action" },
    },
  });
  if (values.probe) return probe();

  if (values.paper.length === 0) throw new Error("give at least one --paper");
  outputFormat(Step, values.schema); // fails fast on an unknown --schema
  const efforts = values.effort.split(",") as Effort[];
  for (const e of efforts)
    if (!EFFORTS.includes(e)) throw new Error(`unknown effort: ${e}`);
  if (values.fixtures && !efforts.includes(values.fixtures as Effort))
    throw new Error(`--fixtures ${values.fixtures} isn't one of --effort`);
  const lessons = JSON.parse(
    await readFile("scripts/s3-spike.lessons.json", "utf8"),
  ) as { papers: Paper[] };

  const results: Attempt[] = [];
  for (const arg of values.paper) {
    const [slug, ...rest] = arg.split("=");
    const pdf = rest.join("=");
    const paper = lessons.papers.find((p) => p.slug === slug);
    if (!paper || !pdf) throw new Error(`--paper wants <slug>=<pdf>: ${arg}`);
    const file = await client.files.upload({
      file: await toFile(await readFile(pdf), `${slug}.pdf`, {
        type: "application/pdf",
      }),
    });
    try {
      for (const effort of efforts) {
        // The first step writes the cache; the others then read it, in parallel.
        results.push(
          ...(await runStep(paper, 0, file.id, effort, values.schema)),
        );
        const rest = await Promise.all(
          paper.concepts
            .slice(1)
            .map((_, k) =>
              runStep(paper, k + 1, file.id, effort, values.schema),
            ),
        );
        results.push(...rest.flat());
      }
    } finally {
      await client.files.delete(file.id);
    }
  }

  await mkdir("evidence/s3", { recursive: true });
  const out = path.join("evidence/s3", `results-${Date.now()}.json`);
  await writeFile(out, JSON.stringify(results, null, 2));
  console.log(`\nresults: ${out}\n`);
  console.log(summary(results));

  if (values.fixtures) {
    for (const a of results.filter(
      (r) => r.ok && r.effort === values.fixtures,
    )) {
      const name = path.join(
        config.fixturesDir,
        `${a.paper}-${a.concept}.step.json`,
      );
      await writeFile(name, JSON.stringify(a.step, null, 2) + "\n");
      console.log(`fixture: ${name}`);
    }
  }
}

/** Markdown table: validity, latency and tokens per paper and effort. */
function summary(results: Attempt[]): string {
  const rows = [
    "| Paper | Effort | Valid first try | Valid after retry | Latency per request (median, max) | Output tokens (median) |",
    "|---|---|---|---|---|---|",
  ];
  const median = (xs: number[]) =>
    [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const groups = new Map<string, Attempt[]>();
  for (const r of results) {
    const key = `${r.paper}|${r.effort}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [key, rs] of groups) {
    const [paper, effort] = key.split("|");
    const firsts = rs.filter((r) => r.attempt === 1);
    const steps = firsts.length;
    const firstOk = firsts.filter((r) => r.ok).length;
    const anyOk = new Set(rs.filter((r) => r.ok).map((r) => r.concept)).size;
    const lat = rs.map((r) => r.latencyMs);
    rows.push(
      `| ${paper} | ${effort} | ${firstOk}/${steps} | ${anyOk}/${steps} | ${(median(lat) / 1000).toFixed(1)} s, ${(Math.max(...lat) / 1000).toFixed(1)} s | ${median(rs.map((r) => r.usage.output))} |`,
    );
  }
  return rows.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
