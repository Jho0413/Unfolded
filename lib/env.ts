// Reads and validates the environment once (ARCHITECTURE.md section 9).
//
// instrumentation.ts register() calls loadEnv() at server start, so a missing key stops the
// server before it serves anything, and the error names the key. `next build` never calls
// it. Code behind it calls getEnv() and trusts the values.
//
// Modes, first match wins:
//   REPLAY_RUN=<lessonId>  serve a saved run; needs runs/<lessonId>/, no keys
//   FAKE_APIS=1            all three providers come from lib/fakes/; no keys
//   otherwise (real)       ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID
import "server-only";
import { statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { LessonId } from "@/shared/lesson";
import { config } from "@/lib/config";

// `KEY=` in .env.local (as copied from .env.example) means "not set", not "set to ''".
const optional = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().optional(),
);
const flag = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.enum(["0", "1"], { error: 'must be "1" or "0"' }).optional(),
);

const RawEnv = z.object({
  ANTHROPIC_API_KEY: optional,
  ELEVENLABS_API_KEY: optional,
  ELEVENLABS_VOICE_ID: optional,
  ELEVENLABS_AGENT_ID: optional,
  FAL_KEY: optional,
  FAKE_APIS: flag,
  REPLAY_RUN: optional,
});

const REAL_REQUIRED = [
  "ANTHROPIC_API_KEY",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
] as const;

interface Keys {
  ANTHROPIC_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
  /** Only the token route needs it; without it, Ask shows "Questions are unavailable right now." */
  ELEVENLABS_AGENT_ID?: string;
  /** Optional in every mode: without it, every image is hidden. */
  FAL_KEY?: string;
}

export type Env =
  | (Keys & {
      mode: "real";
      ANTHROPIC_API_KEY: string;
      ELEVENLABS_API_KEY: string;
      ELEVENLABS_VOICE_ID: string;
    })
  | (Keys & { mode: "fake" })
  | (Keys & { mode: "replay"; replayRun: string });

export class EnvError extends Error {
  override name = "EnvError";
}

export interface ParseEnvOptions {
  /** Where REPLAY_RUN folders live. Defaults to config.runsDir. */
  runsDir?: string;
  /**
   * The build inlined NEXT_PUBLIC_FAKE_APIS=1, so the browser runs the scripted fake
   * conversation. Such a build (e.g. left over from a local `npm run e2e`) must not start
   * in real mode.
   */
  builtWithBrowserFakes?: boolean;
}

/** Pure: validates `source` for the mode it selects. Throws EnvError naming every bad key. */
export function parseEnv(
  source: Record<string, string | undefined>,
  options: ParseEnvOptions = {},
): Env {
  const parsed = RawEnv.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (i) => `${i.path.join(".")} ${i.message}`,
    );
    throw new EnvError(`Invalid env: ${problems.join("; ")}.`);
  }
  const raw = parsed.data;
  const keys: Keys = {
    ANTHROPIC_API_KEY: raw.ANTHROPIC_API_KEY,
    ELEVENLABS_API_KEY: raw.ELEVENLABS_API_KEY,
    ELEVENLABS_VOICE_ID: raw.ELEVENLABS_VOICE_ID,
    ELEVENLABS_AGENT_ID: raw.ELEVENLABS_AGENT_ID,
    FAL_KEY: raw.FAL_KEY,
  };

  if (raw.REPLAY_RUN !== undefined) {
    const id = LessonId.safeParse(raw.REPLAY_RUN);
    if (!id.success) {
      throw new EnvError(
        `REPLAY_RUN must be a lesson id (lowercase letters, digits and "-"), got "${raw.REPLAY_RUN}".`,
      );
    }
    // turbopackIgnore: a runtime path, so the build must not trace the whole project.
    const dir = path.join(
      /* turbopackIgnore: true */ options.runsDir ?? config.runsDir,
      id.data,
    );
    const stat = statSync(/* turbopackIgnore: true */ dir, {
      throwIfNoEntry: false,
    });
    if (!stat?.isDirectory()) {
      throw new EnvError(
        `REPLAY_RUN=${id.data}, but the run folder ${dir} does not exist.`,
      );
    }
    return { ...keys, mode: "replay", replayRun: id.data };
  }

  if (raw.FAKE_APIS === "1") return { ...keys, mode: "fake" };

  if (options.builtWithBrowserFakes) {
    throw new EnvError(
      "This build was made with NEXT_PUBLIC_FAKE_APIS=1 (e.g. by npm run e2e), so the browser would use the fake Q&A agent. Run `npm run build` again without it, or start with FAKE_APIS=1.",
    );
  }
  const missing = REAL_REQUIRED.filter((k) => keys[k] === undefined);
  if (missing.length > 0) {
    throw new EnvError(
      `Missing required env var${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Set ${missing.length > 1 ? "them" : "it"} in .env.local (see .env.example), or run with FAKE_APIS=1.`,
    );
  }
  return {
    ...keys,
    mode: "real",
    ANTHROPIC_API_KEY: keys.ANTHROPIC_API_KEY!,
    ELEVENLABS_API_KEY: keys.ELEVENLABS_API_KEY!,
    ELEVENLABS_VOICE_ID: keys.ELEVENLABS_VOICE_ID!,
  };
}

let cached: Env | undefined;

/** Validates process.env and caches the result. Called once, from instrumentation.ts. */
export function loadEnv(): Env {
  cached = parseEnv(process.env, {
    // Written out in full so Next inlines the value this build was made with.
    builtWithBrowserFakes: process.env.NEXT_PUBLIC_FAKE_APIS === "1",
  });
  return cached;
}

/** The validated env. Validates on first use if register() hasn't run (e.g. in route tests). */
export function getEnv(): Env {
  return cached ?? loadEnv();
}

/** Tests only: forget the cached env so the next getEnv() reads process.env again. */
export function resetEnvForTests(): void {
  cached = undefined;
}
