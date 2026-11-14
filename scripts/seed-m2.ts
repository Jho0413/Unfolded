// npm run seed:m2 (ROADMAP G2): seeds each lesson in scripts/seed-m2.lessons.json (the Attention
// paper and Kelley's "Newton's Method in Three Precisions") as a run folder the step route can
// generate from: the paper uploaded with the Files API (paper.json) and the hand-made plan
// (plan.json). Then POST /api/lessons/<lessonId>/steps/<n> makes each step, and
// /lesson/<lessonId> plays it.
//
//   npm run seed:m2                                   every lesson, papers fetched from pdfUrl
//   npm run seed:m2 -- --only m2-attention            one lesson
//   npm run seed:m2 -- --pdf m2-attention=paper.pdf   a local copy instead of the download
//
// Real mode needs only ANTHROPIC_API_KEY (an upload costs nothing; the steps' requests do).
// FAKE_APIS=1 uses the recorded upload response. Seeding again uploads again and replaces
// paper.json and plan.json; steps already saved stay.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "@/lib/config";
import { loadEnvFor } from "@/lib/env";
import { fakeFiles } from "@/lib/fakes/claude";
import type { ClaudeFiles } from "@/lib/pipeline/generate";
import { parseSeedFile, seedLesson } from "@/lib/pipeline/seed";
import { listRunFiles } from "@/lib/runs/store";

const SEED_FILE = "scripts/seed-m2.lessons.json";
/** arXiv answers in a second or two; a stalled download fails rather than hangs. */
const DOWNLOAD_TIMEOUT_MS = 60_000;

async function main() {
  const { values } = parseArgs({
    options: {
      only: { type: "string", multiple: true, default: [] },
      pdf: { type: "string", multiple: true, default: [] },
    },
  });
  const env = loadEnvFor(["ANTHROPIC_API_KEY"]);
  let files: ClaudeFiles;
  switch (env.mode) {
    case "real":
      // A key passed in code is the client's only credential.
      files = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }).files;
      break;
    case "fake":
      files = fakeFiles();
      break;
    case "replay":
      throw new Error("REPLAY_RUN is set: replay never uploads. Unset it.");
  }

  // Checked before anything is fetched or uploaded.
  const all = parseSeedFile(JSON.parse(await readFile(SEED_FILE, "utf8")));
  const unknown = values.only.filter(
    (id) => !all.some((l) => l.lessonId === id),
  );
  if (unknown.length > 0)
    throw new Error(`--only: no such lesson in ${SEED_FILE}: ${unknown}`);
  const lessons =
    values.only.length === 0
      ? all
      : all.filter((l) => values.only.includes(l.lessonId));
  const localPdfs = new Map(
    values.pdf.map((arg) => {
      const [id, ...rest] = arg.split("=");
      if (!id || rest.length === 0)
        throw new Error(`--pdf wants <lessonId>=<file>: ${arg}`);
      return [id, rest.join("=")];
    }),
  );

  console.log(`seed:m2 (${env.mode} mode) into ${config.runsDir}`);
  for (const lesson of lessons) {
    const local = localPdfs.get(lesson.lessonId);
    const pdf = local
      ? new Uint8Array(await readFile(local))
      : await download(lesson.pdfUrl);
    const paper = await seedLesson(lesson, pdf, files);
    const steps = (await listRunFiles(lesson.lessonId)).filter((f) =>
      f.startsWith("step-"),
    );
    console.log(
      `${lesson.lessonId}: ${lesson.plan.steps.length} steps, paper ${paper.fileId} (${pdf.length} bytes from ${local ?? lesson.pdfUrl})` +
        (steps.length > 0 ? `; ${steps.length} saved step files kept` : ""),
    );
    console.log(`  ${path.join(config.runsDir, lesson.lessonId)}`);
  }
}

async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

main().catch((err: unknown) => {
  // GenerationError messages hold the SDK's error, never the key.
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exitCode = 1;
});
