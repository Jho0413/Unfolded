// Reads and validates the environment once (ARCHITECTURE.md section 9).
//
// instrumentation.ts register() calls loadEnvOrExit() at server start, so a missing key
// stops the server (exit code 1) before it serves a request, and the error names the key.
// `next build` never calls it. Code behind it calls getEnv() and trusts the values.
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
const blankToUndefined = (v: unknown) => {
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t === "" ? undefined : t;
};
const optional = z.preprocess(blankToUndefined, z.string().optional());
const flag = z.preprocess(
  blankToUndefined,
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
   * in real mode. The reverse (FAKE_APIS=1 on a real build) only logs a warning.
   */
  builtWithBrowserFakes?: boolean;
  /** A dev script (loadEnvFor): there is no browser, so neither browser check applies. */
  noBrowser?: boolean;
}

/**
 * Validates `source` for the mode it selects. Throws EnvError naming every bad key. Not
 * pure: replay mode checks the run folder on disk, and fake mode may log a warning.
 */
export function parseEnv(
  source: Record<string, string | undefined>,
  options: ParseEnvOptions = {},
): Env {
  return parseEnvNeeding(source, options, REAL_REQUIRED) as Env;
}

/** The keys a real mode can require. */
export type RequiredKey = (typeof REAL_REQUIRED)[number];

/** Like Env, but real mode only guarantees the keys K (dev scripts that call one provider). */
export type EnvFor<K extends RequiredKey> =
  | (Keys & { mode: "real" } & { [P in K]: string })
  | (Keys & { mode: "fake" })
  | (Keys & { mode: "replay"; replayRun: string });

/**
 * Dev scripts only (scripts/): validates process.env like loadEnv, but real mode needs only
 * `required`, e.g. `npm run make:m1` needs the ElevenLabs keys and not ANTHROPIC_API_KEY.
 * Not cached, so it never stands in for the server's getEnv().
 */
export function loadEnvFor<const K extends RequiredKey>(
  required: readonly [K, ...K[]],
): EnvFor<K> {
  return parseEnvNeeding(
    process.env,
    { noBrowser: true },
    required,
  ) as EnvFor<K>;
}

function parseEnvNeeding(
  source: Record<string, string | undefined>,
  options: ParseEnvOptions,
  required: readonly RequiredKey[],
): EnvFor<never> {
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

  if (raw.FAKE_APIS === "1") {
    if (!options.builtWithBrowserFakes && !options.noBrowser) {
      // Allowed (route tests, debugging), but Ask would try the real ElevenLabs agent.
      console.warn(
        "[env] FAKE_APIS=1, but this build's browser uses the real Q&A agent (built without NEXT_PUBLIC_FAKE_APIS=1).",
      );
    }
    return { ...keys, mode: "fake" };
  }

  if (options.builtWithBrowserFakes) {
    throw new EnvError(
      "NEXT_PUBLIC_FAKE_APIS=1 without FAKE_APIS=1: the browser would use the fake Q&A agent with real providers. Rebuild without NEXT_PUBLIC_FAKE_APIS (npm run build; e.g. after npm run e2e), or set FAKE_APIS=1.",
    );
  }
  const missing = required.filter((k) => keys[k] === undefined);
  if (missing.length > 0) {
    throw new EnvError(
      `Missing required env var${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Set ${missing.length > 1 ? "them" : "it"} in .env.local (see .env.example), or run with FAKE_APIS=1.`,
    );
  }
  // Every key in `required` was checked above; the callers' casts rely on it.
  return { ...keys, mode: "real" };
}

let cached: Env | undefined;

/** Validates process.env and caches the result. Throws EnvError if it is invalid. */
export function loadEnv(): Env {
  cached = parseEnv(process.env, {
    // Inlined by next.config.ts `env` from NEXT_PUBLIC_FAKE_APIS at build time. Under
    // `next dev` and Vitest it's read live, which matches what the browser gets there.
    builtWithBrowserFakes:
      (process.env.BUILT_WITH_BROWSER_FAKES ??
        process.env.NEXT_PUBLIC_FAKE_APIS) === "1",
  });
  return cached;
}

/**
 * Server start (instrumentation.ts): validates process.env, or logs why and exits with 1.
 * Next logs an error thrown from register() and serves anyway (a 500 on every request), so
 * exiting is how the server refuses to start. The message names keys, never their values.
 */
export function loadEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (err) {
    if (!(err instanceof EnvError)) throw err;
    console.error(`[env] ${err.message}`);
    process.exit(1);
  }
}

/** The validated env. Validates on first use if register() hasn't run (e.g. in route tests). */
export function getEnv(): Env {
  return cached ?? loadEnv();
}

/** Tests only: forget the cached env so the next getEnv() reads process.env again. */
export function resetEnvForTests(): void {
  cached = undefined;
}
