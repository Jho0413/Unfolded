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
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
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

/** The content type a run file is served with, or undefined when the store doesn't serve it. */
export function contentTypeFor(file: string): string | undefined {
  return CONTENT_TYPES[path.extname(file)];
}

/** A lessonId and file name the store accepts: the shared rules plus a known extension. */
export function isServableName(lessonId: string, file: string): boolean {
  return (
    LessonId.safeParse(lessonId).success &&
    RunFileName.safeParse(file).success &&
    contentTypeFor(file) !== undefined
  );
}

// ---------------------------------------------------------------- versioned step files

const STEP_FILE_RE = /^step-(0|[1-9]\d*)\.v([1-9]\d*)\.json$/;

/** step-<n>.v<k>.json: the step script and its cue times. */
export function stepFileName(n: number, version: number): string {
  return `step-${n}.v${version}.json`;
}

/** step-<n>.v<k>.mp3: the narration audio of that version. */
export function stepAudioFileName(n: number, version: number): string {
  return `step-${n}.v${version}.mp3`;
}

/** The versions of step n among a folder's file names, oldest first. */
export function stepVersions(files: readonly string[], n: number): number[] {
  const versions: number[] = [];
  for (const file of files) {
    const m = STEP_FILE_RE.exec(file);
    if (m && Number(m[1]) === n) versions.push(Number(m[2]));
  }
  return versions.sort((a, b) => a - b);
}

/** The version a new generation of step n is saved as: one past the newest. */
export function nextStepVersion(files: readonly string[], n: number): number {
  const versions = stepVersions(files, n);
  return versions.length === 0 ? 1 : versions[versions.length - 1] + 1;
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

const isMissing = (err: unknown) =>
  err instanceof Error &&
  "code" in err &&
  (err.code === "ENOENT" || err.code === "ENOTDIR");

/** The file names in a lesson's run folder. Empty when the folder doesn't exist yet. */
export async function listRunFiles(lessonId: string): Promise<string[]> {
  try {
    return await readdir(runDir(lessonId));
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

/**
 * Writes a file into runs/<lessonId>/, creating the folder. Atomic: the data goes to a
 * temporary file first, then is renamed into place. The temporary name has a "_", which no
 * run file name allows, so it can never be served.
 */
export async function writeRunFile(
  lessonId: string,
  file: string,
  data: string | Uint8Array,
): Promise<void> {
  const target = runFilePath(lessonId, file);
  const dir = path.dirname(target);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `_${randomUUID()}.tmp`);
  try {
    const handle = await open(tmp, "wx");
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true });
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
  } catch (err) {
    if (err instanceof RunNameError)
      return { kind: "refused", reason: err.message };
    throw err;
  }
  try {
    // The lesson folder itself must be a real folder, not a link to somewhere else.
    const dir = await lstat(path.dirname(target));
    if (!dir.isDirectory())
      return { kind: "refused", reason: "run folder is not a directory" };
    // lstat before open: opening a FIFO would block, and a folder isn't a file.
    const before = await lstat(target);
    if (!before.isFile())
      return { kind: "refused", reason: "not a regular file" };
    // O_NOFOLLOW refuses a symlink swapped in after the lstat above.
    const handle = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const after = await handle.stat();
      if (!after.isFile() || after.ino !== before.ino)
        return { kind: "refused", reason: "file changed while opening" };
      return { kind: "ok", data: await handle.readFile() };
    } finally {
      await handle.close();
    }
  } catch (err) {
    if (isMissing(err)) return { kind: "missing" };
    if (err instanceof Error && "code" in err && err.code === "ELOOP")
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
