// The run store: one folder per lesson, runs/<lessonId>/ (ARCHITECTURE.md sections 5.1 and
// 5.5). It is both the live store and the replay set, so every write is atomic (a reader
// never sees half a file) and step files are versioned: step-<n>.v<k>.json and its audio
// step-<n>.v<k>.mp3. A new version never overwrites an old one.
//
// Every lessonId and file name is checked here, at the boundary, against the shared rules
// in shared/lesson.ts. Reads also refuse symlinks and anything that isn't a regular file,
// so nothing outside a run folder can be read through it.
import "server-only";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { z } from "zod";
import { LessonId, RunFileName } from "@/shared/lesson";
import { config } from "@/lib/config";

/** What the route may serve, by extension. Anything else is never served. */
const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * The content type a run file is served with, or undefined when the route must not serve
 * it: a bad lessonId or file name, or an extension the store doesn't serve.
 */
export function servableContentType(
  lessonId: string,
  file: string,
): string | undefined {
  if (!LessonId.safeParse(lessonId).success) return undefined;
  if (!RunFileName.safeParse(file).success) return undefined;
  return CONTENT_TYPES[path.extname(file)];
}

// ---------------------------------------------------------------- versioned step files

const STEP_FILE_RE = /^step-(0|[1-9]\d*)\.v([1-9]\d*)\.(json|mp3)$/;

/** step-<n>.v<k>.json: the step script and its cue times. */
export function stepFileName(n: number, version: number): string {
  return `step-${n}.v${version}.json`;
}

/** step-<n>.v<k>.mp3: the narration audio of that version. */
export function stepAudioFileName(n: number, version: number): string {
  return `step-${n}.v${version}.mp3`;
}

function versionsOf(
  files: readonly string[],
  n: number,
  kinds: readonly string[],
): number[] {
  const versions: number[] = [];
  for (const file of files) {
    const m = STEP_FILE_RE.exec(file);
    if (m && Number(m[1]) === n && kinds.includes(m[3]))
      versions.push(Number(m[2]));
  }
  return versions.sort((a, b) => a - b);
}

/** The saved versions of step n (those with a step-<n>.v<k>.json), oldest first. */
export function stepVersions(files: readonly string[], n: number): number[] {
  return versionsOf(files, n, ["json"]);
}

/**
 * The version a new generation of step n is saved as: one past the newest file of step n,
 * audio included, so a version whose save stopped after its audio is never reused.
 */
export function nextStepVersion(files: readonly string[], n: number): number {
  const taken = versionsOf(files, n, ["json", "mp3"]);
  return taken.length === 0 ? 1 : taken[taken.length - 1] + 1;
}

// ---------------------------------------------------------------- disk

export class RunNameError extends Error {
  override name = "RunNameError";
}

function runDir(lessonId: string): string {
  if (!LessonId.safeParse(lessonId).success)
    throw new RunNameError(`bad lessonId: ${JSON.stringify(lessonId)}`);
  return path.join(config.runsDir, lessonId);
}

function runFilePath(lessonId: string, file: string): string {
  const dir = runDir(lessonId);
  if (!RunFileName.safeParse(file).success)
    throw new RunNameError(`bad run file name: ${JSON.stringify(file)}`);
  return path.join(dir, file);
}

const errorCode = (err: unknown) =>
  err instanceof Error && "code" in err ? err.code : undefined;
const isMissing = (err: unknown) =>
  errorCode(err) === "ENOENT" || errorCode(err) === "ENOTDIR";

/** runs/<lessonId>/ must be a real folder: a symlink there could point anywhere. */
async function checkRunDir(dir: string): Promise<void> {
  if (!(await lstat(dir)).isDirectory())
    throw new RunNameError(`run folder is not a directory: ${dir}`);
}

/** Creates runs/<lessonId>/ if needed (never through a symlink) and returns its path. */
async function ensureRunDir(lessonId: string): Promise<string> {
  const dir = runDir(lessonId);
  await mkdir(config.runsDir, { recursive: true });
  try {
    await mkdir(dir);
  } catch (err) {
    if (errorCode(err) !== "EEXIST") throw err;
  }
  await checkRunDir(dir);
  return dir;
}

/** The file names in a lesson's run folder. Empty when the folder doesn't exist yet. */
export async function listRunFiles(lessonId: string): Promise<string[]> {
  const dir = runDir(lessonId);
  try {
    await checkRunDir(dir);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  return readdir(dir);
}

/**
 * Writes data to a new temporary file in dir and returns its path. The temporary name has a
 * "_", which no run file name allows, so it can never be served or taken for a step file.
 */
async function writeTemp(dir: string, data: string | Uint8Array) {
  const tmp = path.join(dir, `_${randomUUID()}.tmp`);
  const handle = await open(tmp, "wx");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } catch (err) {
    await handle.close().catch(() => {});
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  await handle.close();
  return tmp;
}

/**
 * Writes a file into runs/<lessonId>/, creating the folder, replacing any file of that name.
 * Atomic: the data goes to a temporary file, then is renamed into place, so a reader sees
 * the old file or the new one, never half of one. Step versions use saveStepVersion instead.
 */
export async function writeRunFile(
  lessonId: string,
  file: string,
  data: string | Uint8Array,
): Promise<void> {
  const target = runFilePath(lessonId, file);
  const tmp = await writeTemp(await ensureRunDir(lessonId), data);
  try {
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Writes a value as pretty JSON (the run folder is read by people too). */
export async function writeRunJson(
  lessonId: string,
  file: string,
  value: unknown,
): Promise<void> {
  await writeRunFile(lessonId, file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Like writeRunFile, but never replaces an existing file: link() fails atomically when the
 * name is taken. Returns false when it was.
 */
async function createRunFile(
  lessonId: string,
  file: string,
  data: string | Uint8Array,
): Promise<boolean> {
  const target = runFilePath(lessonId, file);
  const tmp = await writeTemp(await ensureRunDir(lessonId), data);
  try {
    await link(tmp, target);
    return true;
  } catch (err) {
    if (errorCode(err) === "EEXIST") return false;
    throw err;
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

/**
 * Saves a new version of step n: its audio (step-<n>.v<k>.mp3), then its JSON
 * (step-<n>.v<k>.json). Returns k. Creating the audio claims version k, so two saves never
 * share a version and an older version is never overwritten. The JSON goes last, so once
 * a version is listed its audio is already there.
 */
export async function saveStepVersion(
  lessonId: string,
  n: number,
  step: unknown,
  audio: Uint8Array,
): Promise<number> {
  for (;;) {
    const k = nextStepVersion(await listRunFiles(lessonId), n);
    if (!(await createRunFile(lessonId, stepAudioFileName(n, k), audio)))
      continue;
    const json = `${JSON.stringify(step, null, 2)}\n`;
    if (await createRunFile(lessonId, stepFileName(n, k), json)) return k;
  }
}

export type ReadResult =
  | { kind: "ok"; data: Buffer }
  /** No such lesson folder or file. */
  | { kind: "missing" }
  /** The name is bad, or the path is a symlink, a folder or another non-regular file. */
  | { kind: "refused"; reason: string };

/** Reads a file from runs/<lessonId>/ without following symlinks or reading folders. */
export async function readRunFile(
  lessonId: string,
  file: string,
): Promise<ReadResult> {
  let target: string;
  try {
    target = runFilePath(lessonId, file);
    await checkRunDir(path.dirname(target));
  } catch (err) {
    if (err instanceof RunNameError)
      return { kind: "refused", reason: err.message };
    if (isMissing(err)) return { kind: "missing" };
    throw err;
  }
  try {
    // O_NOFOLLOW refuses a symlink; O_NONBLOCK keeps a FIFO from blocking the open. What
    // is opened is then checked on the handle itself, so nothing can be swapped in between.
    const handle = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      if (!(await handle.stat()).isFile())
        return { kind: "refused", reason: "not a regular file" };
      return { kind: "ok", data: await handle.readFile() };
    } finally {
      await handle.close();
    }
  } catch (err) {
    if (isMissing(err)) return { kind: "missing" };
    if (errorCode(err) === "ELOOP")
      return { kind: "refused", reason: "symlink" };
    throw err;
  }
}

/** Reads and validates a JSON run file. Undefined when it's missing; throws when invalid. */
export async function readRunJson<T>(
  lessonId: string,
  file: string,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  const result = await readRunFile(lessonId, file);
  if (result.kind === "missing") return undefined;
  if (result.kind === "refused")
    throw new RunNameError(`can't read ${lessonId}/${file}: ${result.reason}`);
  return schema.parse(JSON.parse(result.data.toString("utf8")));
}
