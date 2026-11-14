// npm run make:m1 (ROADMAP C1): writes runs/demo-m1/ from lib/fakes/fixtures/demo-m1.step.json
// and prints a cue -> word -> time table. Real mode calls ElevenLabs once (about 280
// characters of credit) and needs only ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID; with
// FAKE_APIS=1 it uses S1's recorded response (its audio is cut short). Each run saves a new
// step version, so earlier ones stay.
//
// Two checks, both within TOLERANCE_MS:
// - alignment: each cue time (the walk in cues.ts) against the alignment entry at the cue's
//   code point (S1: one entry per code point). Catches a walk that resynced wrongly.
// - audio length: the alignment's end against the MP3's length from its frames. Catches
//   timestamps on a different timeline from the audio.
// Neither listens to the words: the PR records a check of cues against the audio itself.
import path from "node:path";
import { config } from "@/lib/config";
import { loadEnvFor } from "@/lib/env";
import { NoAlignmentError } from "@/lib/narration/cues";
import { M1_LESSON_ID, cueTable, makeM1 } from "@/lib/narration/makeM1";
import { stepAudioFileName, stepFileName } from "@/lib/runs/store";

/** ROADMAP C1: each cue time must be within this of the audio. */
const TOLERANCE_MS = 100;

async function main() {
  const env = loadEnvFor(["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"]);
  console.log(`make:m1 (${env.mode} mode, model ${config.tts.modelId})`);
  if (env.mode === "fake")
    console.log(
      "FAKE_APIS=1: using the recorded TTS response; its audio is cut short, so the audio length isn't checked.",
    );

  const made = await makeM1(env);
  const dir = path.join(config.runsDir, M1_LESSON_ID);
  console.log(`wrote ${path.join(dir, stepFileName(0, made.version))}`);
  console.log(
    `wrote ${path.join(dir, stepAudioFileName(0, made.version))} (${made.audioBytes} bytes)`,
  );
  console.log(`wrote ${path.join(dir, "plan.json")}`);

  let bad = 0;
  const rows = cueTable(made.narration, made.cueTimes, made.alignment);
  console.log("\n| cue | word | time (ms) | alignment entry (ms) | diff |");
  console.log("|---|---|---|---|---|");
  for (const r of rows) {
    const diff = r.indexMs === undefined ? undefined : r.ms - r.indexMs;
    if (diff === undefined || Math.abs(diff) > TOLERANCE_MS) bad++;
    console.log(
      `| ${r.cue} | ${r.word} | ${r.ms} | ${r.indexMs ?? "-"} | ${diff ?? "-"} |`,
    );
  }

  const end = made.alignment?.character_end_times_seconds.at(-1);
  const endMs = end === undefined ? undefined : Math.round(end * 1000);
  const lengthDiff =
    endMs === undefined || made.audioMs === undefined
      ? undefined
      : made.audioMs - endMs;
  console.log(
    `\naudio length: ${made.audioMs ?? "?"} ms from the MP3 frames, ${endMs ?? "?"} ms from the alignment (diff ${lengthDiff ?? "?"})`,
  );
  // The fixture's audio is cut short, so only real audio can pass this.
  if (
    env.mode === "real" &&
    (lengthDiff === undefined || Math.abs(lengthDiff) > TOLERANCE_MS)
  )
    bad++;

  if (bad > 0) {
    console.error(`\n${bad} check(s) off by more than ${TOLERANCE_MS} ms`);
    process.exitCode = 1;
  } else {
    console.log(
      env.mode === "real"
        ? `\nevery cue matches its alignment entry, and the alignment matches the audio length, within ${TOLERANCE_MS} ms`
        : `\nevery cue matches its alignment entry within ${TOLERANCE_MS} ms (audio length not checked)`,
    );
  }
}

main().catch((err: unknown) => {
  // TtsError and NoAlignmentError messages never hold the key.
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  if (err instanceof NoAlignmentError)
    console.error(`reason: ${err.reason}\ntext: ${err.text}`);
  process.exitCode = 1;
});
