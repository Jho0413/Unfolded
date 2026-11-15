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
import {
  EMPTY_SIGNALS,
  LessonId,
  RUN_FILE_RE,
  RunFileName,
  type Signal,
  SignalsFile,
  signalsVersion,
} from "@/shared/lesson";
import { config } from "@/lib/config";

/** What the route may serve, by extension. Anything else is never served. */
const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
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

/** The lesson's plan (shared/lesson.ts LessonPlan): written last when a lesson is made. */
export const PLAN_FILE = "plan.json";
/** The paper's Files API id (lib/pipeline/plan.ts SavedPaper), for the step requests. */
export const PAPER_FILE = "paper.json";
/**
 * The uploaded PDF itself, byte for byte, for the paper viewer beside the board (#98), served
 * by GET /api/runs/<lessonId>/paper.pdf.
 */
export const PAPER_PDF_FILE = "paper.pdf";
/** The learner's signals (shared/lesson.ts SignalsFile), appended by the signals route (section 5.4). */
export const SIGNALS_FILE = "signals.json";
/**
 * paper.pdf's page text, extracted once for checking the step generator's quotes (#98,
 * lib/pipeline/paperPages.ts).
 */
export const PAPER_TEXT_FILE = "paper-text.json";

// ---------------------------------------------------------------- versioned step files

const STEP_FILE_RE = /^step-(0|[1-9]\d*)\.v([1-9]\d*)\.(json|mp3)$/;

/** Step n (0-based) and version k (from 1) must be whole numbers, or the name won't parse back. */
function checkStepNumbers(n: number, version: number): void {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RunNameError(`bad step number: ${n}`);
  if (!Number.isSafeInteger(version) || version < 1)
    throw new RunNameError(`bad step version: ${version}`);
}

/** step-<n>.v<k>.json: the step script and its cue times. */
export function stepFileName(n: number, version: number): string {
  checkStepNumbers(n, version);
  return `step-${n}.v${version}.json`;
}

/** step-<n>.v<k>.mp3: the narration audio of that version. */
export function stepAudioFileName(n: number, version: number): string {
  checkStepNumbers(n, version);
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
    // A hand-made version too large to count past is ignored rather than blocking saves.
    if (
      m &&
      Number(m[1]) === n &&
      kinds.includes(m[3]) &&
      Number.isSafeInteger(Number(m[2]) + 1)
    )
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

/**
 * runs/<lessonId>/ must be a real folder: a symlink there could point anywhere. The folder
 * could still be swapped between this check and an open (Node has no openat), but that
 * needs write access to runs/ on the laptop itself, which already means full access.
 */
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

/**
 * The run file names in a lesson's folder (temporary files of writes in progress left out).
 * Empty when the folder doesn't exist yet.
 */
export async function listRunFiles(lessonId: string): Promise<string[]> {
  const dir = runDir(lessonId);
  try {
    await checkRunDir(dir);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  return (await readdir(dir)).filter((file) => RUN_FILE_RE.test(file));
}

/**
 * Writes data to a new temporary file in dir and returns its path. The temporary name has a
 * "_", which no run file name allows, so it can never be served or taken for a step file.
 */
async function writeTemp(dir: string, data: string | Uint8Array) {
  const tmp = path.join(dir, `_${randomUUID()}.tmp`);
  const handle = await open(tmp, "wx");
  try {
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
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

/** Pretty JSON (the run folder is read by people too). Throws when value has no JSON form. */
function toJsonText(value: unknown): string {
  const text: string | undefined = JSON.stringify(value, null, 2);
  if (text === undefined)
    throw new TypeError(`no JSON form for ${String(value)}`);
  return `${text}\n`;
}

/** Writes a value as JSON. Throws, writing nothing, when the value has no JSON form. */
export async function writeRunJson(
  lessonId: string,
  file: string,
  value: unknown,
): Promise<void> {
  await writeRunFile(lessonId, file, toJsonText(value));
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

/** How many taken versions a save skips before giving up, so a name clash can't spin forever. */
const MAX_VERSION_CLAIMS = 100;

/**
 * Saves a new version of step n: its audio (step-<n>.v<k>.mp3), then its JSON
 * (step-<n>.v<k>.json). Returns k. Creating the audio claims version k, so two saves never
 * share a version and an older version is never overwritten; if k is taken, it tries the
 * next one. The JSON goes last, so once a version is listed its audio is already there.
 */
export async function saveStepVersion(
  lessonId: string,
  n: number,
  step: unknown,
  audio: Uint8Array,
): Promise<number> {
  checkStepNumbers(n, 1);
  // Serialised before claiming a version, so a step that can't be saved leaves no audio.
  const json = toJsonText(step);
  for (let tries = 0; tries < MAX_VERSION_CLAIMS; tries++) {
    const k = nextStepVersion(await listRunFiles(lessonId), n);
    if (!(await createRunFile(lessonId, stepAudioFileName(n, k), audio)))
      continue;
    if (await createRunFile(lessonId, stepFileName(n, k), json)) return k;
    // Only something writing step files outside saveStepVersion can get here.
    throw new Error(
      `${lessonId}/${stepFileName(n, k)} exists without its audio claim`,
    );
  }
  throw new Error(
    `couldn't claim a version of step ${n} in ${lessonId} after ${MAX_VERSION_CLAIMS} tries`,
  );
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
    // A socket can't be opened as a file.
    if (errorCode(err) === "ENXIO")
      return { kind: "refused", reason: "not a regular file" };
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

// ---------------------------------------------------------------- signals.json

/** Reads signals.json: EMPTY_SIGNALS when it's missing; throws when it isn't a SignalsFile. */
export async function readSignals(lessonId: string): Promise<SignalsFile> {
  return (
    (await readRunJson(lessonId, SIGNALS_FILE, SignalsFile)) ?? EMPTY_SIGNALS
  );
}

/**
 * lessonId -> the end of its queue of appends. Each append reads, adds and writes signals.json
 * in turn, so two signals arriving together are both kept. One server process (section 1)
 * makes an in-memory lock enough.
 */
const signalAppends = new Map<string, Promise<unknown>>();

/**
 * Appends a signal to runs/<lessonId>/signals.json with the server's time, under the lesson's
 * lock and with an atomic write, and returns the signals version after it. Throws, writing
 * nothing, when the existing file isn't a SignalsFile: it is never overwritten.
 */
export function appendSignal(
  lessonId: string,
  signal: Signal,
  at: Date = new Date(),
): Promise<number> {
  const previous = signalAppends.get(lessonId) ?? Promise.resolve();
  const append = previous
    .catch(() => {})
    .then(async () => {
      const file = await readSignals(lessonId);
      const signals = [...file.signals, { ...signal, at: at.toISOString() }];
      const next = SignalsFile.parse({
        version: signalsVersion(signals),
        signals,
      });
      await writeRunJson(lessonId, SIGNALS_FILE, next);
      return next.version;
    });
  signalAppends.set(lessonId, append);
  // The queue forgets a lesson once its last append is done.
  void append
    .catch(() => {})
    .then(() => {
      if (signalAppends.get(lessonId) === append)
        signalAppends.delete(lessonId);
    });
  return append;
}
