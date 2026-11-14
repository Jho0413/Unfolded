// npm run make:m1 (ROADMAP C1): writes runs/demo-m1/ from lib/fakes/fixtures/demo-m1.step.json
// and prints a cue -> word -> time table. Real mode calls ElevenLabs once (about 280
// characters of credit) and needs only ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID; with
// FAKE_APIS=1 it uses S1's recorded response (its audio is cut short). Each run saves a new
// step version, so earlier ones stay.
import { config } from "@/lib/config";
import { loadEnvFor } from "@/lib/env";
import { M1_LESSON_ID, cueTable, makeM1 } from "@/lib/narration/makeM1";
import { readFixture } from "@/lib/fakes";
import { stepAudioFileName, stepFileName } from "@/lib/runs/store";
import path from "node:path";

/** ROADMAP C1: each cue time must be within this of the audio. */
const TOLERANCE_MS = 100;

async function main() {
  const env = loadEnvFor(["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"]);
  console.log(`make:m1 (${env.mode} mode, model ${config.tts.modelId})`);
  if (env.mode === "fake")
    console.log(
      "FAKE_APIS=1: using the recorded TTS response; its audio is cut short.",
    );

  const made = await makeM1(env);
  const dir = path.join(config.runsDir, M1_LESSON_ID);
  console.log(`wrote ${path.join(dir, "plan.json")}`);
  console.log(`wrote ${path.join(dir, stepFileName(0, made.version))}`);
  console.log(
    `wrote ${path.join(dir, stepAudioFileName(0, made.version))} (${made.audioBytes} bytes)`,
  );

  const { narration } = await readFixture<{ narration: string }>(
    "demo-m1.step.json",
  );
  const rows = cueTable(narration, made.cueTimes, made.alignment);
  const end = made.alignment?.character_end_times_seconds.at(-1);
  console.log(
    `\naudio length from the alignment: ${end === undefined ? "?" : Math.round(end * 1000)} ms\n`,
  );
  console.log("| cue | word | time (ms) | alignment entry (ms) | diff |");
  console.log("|---|---|---|---|---|");
  let bad = 0;
  for (const r of rows) {
    const diff = r.indexMs === undefined ? undefined : r.ms - r.indexMs;
    if (diff === undefined || Math.abs(diff) > TOLERANCE_MS) bad++;
    console.log(
      `| ${r.cue} | ${r.word} | ${r.ms} | ${r.indexMs ?? "-"} | ${diff ?? "-"} |`,
    );
  }
  if (bad > 0) {
    console.error(`\n${bad} cue(s) off by more than ${TOLERANCE_MS} ms`);
    process.exitCode = 1;
  } else {
    console.log(
      `\nevery cue is within ${TOLERANCE_MS} ms of its alignment entry`,
    );
  }
}

main().catch((err: unknown) => {
  // TtsError and NoAlignmentError messages never hold the key.
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exitCode = 1;
});
