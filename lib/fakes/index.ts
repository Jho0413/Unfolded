// The FAKE_APIS switch (ARCHITECTURE.md sections 9 and 10). Provider wrappers (TTS, Claude,
// fal) ask fakesEnabled() and, when it's true, return a recorded fixture instead of calling out.
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import { getEnv } from "@/lib/env";

/** True when FAKE_APIS=1: no provider may be called. */
export function fakesEnabled(): boolean {
  return getEnv().mode === "fake";
}

/** A recorded response from lib/fakes/fixtures/, parsed as JSON. */
export async function readFixture<T = unknown>(name: string): Promise<T> {
  if (!/^[\w-][\w.-]*\.json$/.test(name))
    throw new Error(`bad fixture name: ${name}`);
  const text = await readFile(path.join(config.fixturesDir, name), "utf8");
  return JSON.parse(text) as T;
}
