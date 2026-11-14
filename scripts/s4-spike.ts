// Spike S4 (issue #70, ARCHITECTURE.md section 11): which fal image model makes the lesson
// cover (L4), and later the whiteboard illustrations (E1)? Times one generation per
// (model, prompt), downloads the image (fal's URLs expire) and logs what it cost.
//
// Real fal calls, so it costs money: run it by hand, never in CI or tests.
//   npm run spike:s4 -- --model fal-ai/flux/schnell --prompt attention
//   npm run spike:s4 -- --model fal-ai/flux-2 --prompt attention --direct --accel high
//   npm run spike:s4 -- --price            (prices only, from fal's pricing API: free)
// The key is FAL_KEY from the environment (.env or .env.local); it is never printed.
// Images and evidence/70/log.jsonl go to evidence/70/ (gitignored). MAX_GENERATIONS caps
// the spike's spend: a "started" line is logged before each fal call, so a run that fails
// after fal has charged still counts, and a rerun can't go over the cap.
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { fal } from "@fal-ai/client";

const OUT_DIR = path.join("evidence", "70");
const LOG = path.join(OUT_DIR, "log.jsonl");
/** The spike's budget: at most 0.24 US dollars at the dearest price tried (0.03 per image). */
const MAX_GENERATIONS = 8;
/** Wide, like the plan view's and the lesson page's header (1024 x 576, 0.59 MP). */
const IMAGE_SIZE = "landscape_16_9";

const MODELS = [
  "fal-ai/flux/schnell",
  "fal-ai/flux-2",
  "fal-ai/flux-2-pro",
] as const;
type Model = (typeof MODELS)[number];
/** The FLUX models' `acceleration` input. */
const ACCELERATIONS = ["none", "regular", "high"];

/**
 * Written the way L1's plan prompt asks for a coverPrompt (branch 56-l1-lessons, PR #65):
 * a visual metaphor, no text in the image. `attention` is the coverPrompt of L1's recorded
 * plan for the Attention paper; `newton3p` is written to the same rule for Kelley's paper.
 */
const PROMPTS = {
  attention:
    "A glowing web of luminous threads linking every bead on a long necklace to every other bead at once, with some threads brighter and thicker than others, set against a deep dark background in warm gold and blue.",
  newton3p:
    "A bright arrow sliding down a smooth curve toward the point where it meets a horizontal line, shown three times through nested magnifying lenses, each lens sharper and finer than the last, in deep blue with amber and white light.",
} as const;
type PromptName = keyof typeof PROMPTS;

interface Price {
  unit_price: number;
  unit: string;
}

/** fal's own price list for an endpoint (free to call; needs the key). */
async function priceOf(model: Model, key: string): Promise<Price> {
  const res = await fetch(
    `https://api.fal.ai/v1/models/pricing?endpoint_id=${encodeURIComponent(model)}`,
    { headers: { Authorization: `Key ${key}` } },
  );
  if (!res.ok) throw new Error(`pricing ${model}: HTTP ${res.status}`);
  const body = (await res.json()) as { prices: Price[] };
  return body.prices[0];
}

/**
 * An upper bound on one w x h image's cost, in US dollars: it rounds up to whole megapixels.
 * The exact charge needs fal's usage API, which an ordinary key can't read.
 */
function costOf(price: Price, w: number, h: number): number {
  return price.unit === "images"
    ? price.unit_price
    : // "megapixels" and "processed megapixels"
      price.unit_price * Math.ceil((w * h) / 1_000_000);
}

/**
 * Generations started so far: every log line but the "done" ones (the first lines of the
 * spike were logged only when done, with no `event`).
 */
async function generationsSoFar(): Promise<number> {
  if (!existsSync(LOG)) return 0;
  return (await readFile(LOG, "utf8"))
    .split("\n")
    .filter(Boolean)
    .filter((line) => (JSON.parse(line) as { event?: string }).event !== "done")
    .length;
}

async function main() {
  const { values } = parseArgs({
    options: {
      model: { type: "string" },
      prompt: { type: "string" },
      price: { type: "boolean", default: false },
      /** fal.run: one direct request, no queue to poll (fal.subscribe is the default). */
      direct: { type: "boolean", default: false },
      /** One of ACCELERATIONS. */
      accel: { type: "string" },
    },
  });
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new Error("FAL_KEY is not set (.env or .env.local)");

  if (values.price) {
    for (const m of MODELS) {
      const p = await priceOf(m, key);
      console.log(`${m}: ${p.unit_price} USD per ${p.unit}`);
    }
    return;
  }

  const model = MODELS.find((m) => m === values.model);
  if (!model) throw new Error(`--model must be one of ${MODELS.join(", ")}`);
  const promptName = values.prompt as PromptName;
  if (!Object.hasOwn(PROMPTS, promptName))
    throw new Error(
      `--prompt must be one of ${Object.keys(PROMPTS).join(", ")}`,
    );

  if (values.accel !== undefined && !ACCELERATIONS.includes(values.accel))
    throw new Error(`--accel must be one of ${ACCELERATIONS.join(", ")}`);

  const done = await generationsSoFar();
  if (done >= MAX_GENERATIONS)
    throw new Error(`budget spent: ${done} of ${MAX_GENERATIONS} generations`);

  fal.config({ credentials: key });
  const price = await priceOf(model, key);
  const prompt = PROMPTS[promptName];
  const call = values.direct ? "run" : "subscribe";
  const accel = values.accel ?? "default";
  await mkdir(OUT_DIR, { recursive: true });
  const log = (entry: object) =>
    appendFile(
      LOG,
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    );
  await log({ event: "started", model, prompt: promptName, call, accel });
  const started = performance.now();
  const input = {
    prompt,
    image_size: IMAGE_SIZE,
    output_format: "jpeg",
    ...(values.accel ? { acceleration: values.accel } : {}),
  };
  // As a plain string id, so `acceleration` isn't checked against every model's input type.
  const endpoint: string = model;
  const result = values.direct
    ? await fal.run(endpoint, { input })
    : await fal.subscribe(endpoint, { input });
  const generatedMs = Math.round(performance.now() - started);
  const image = (
    result.data as {
      images: { url: string; width: number; height: number }[];
    }
  ).images[0];
  const res = await fetch(image.url);
  if (!res.ok) throw new Error(`download: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const totalMs = Math.round(performance.now() - started);

  const variant = `${values.direct ? ".run" : ""}${values.accel ? `.${values.accel}` : ""}`;
  const file = `${model.replaceAll("/", "_")}.${promptName}${variant}.jpg`;
  await writeFile(path.join(OUT_DIR, file), bytes);
  const entry = {
    event: "done",
    model,
    prompt: promptName,
    call,
    accel,
    size: `${image.width}x${image.height}`,
    generatedMs,
    totalMs,
    bytes: bytes.length,
    usd: costOf(price, image.width, image.height),
    requestId: result.requestId,
    file,
  };
  await log(entry);
  console.log(JSON.stringify(entry));
  console.log(`generation ${done + 1} of ${MAX_GENERATIONS}`);
}

main().catch((err: unknown) => {
  // fal's ApiError carries the response body, never the key.
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exitCode = 1;
});
