// Cue markers become times (ARCHITECTURE.md section 5.2). Pure: no I/O.
//
// 1. stripMarkers: narration with [[cue]] markers -> the text sent to TTS,
//    plus each cue's character offset (UTF-16 index) in that text.
// 2. cueTimes: that text + the ElevenLabs alignment -> cue -> ms, found by
//    walking alignment.characters against the text, never by index.
import type { CueTimes } from "@/shared/lesson";
import { CUE_MARKER_RE } from "@/shared/scene";

/** A cue and where its marker sat in the stripped text (UTF-16 index, 0..text.length). */
export interface CueOffset {
  cue: string;
  offset: number;
}

export interface StrippedNarration {
  /** Markers stripped, trimmed, whitespace collapsed: the text sent to TTS. */
  text: string;
  /** Cues in text order, duplicates included. */
  cues: CueOffset[];
}

/** The `alignment` of ElevenLabs `/with-timestamps` (times in seconds). */
export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** The step fails with this (ARCHITECTURE.md section 6.2); log `text` and `alignment`. */
export class NoAlignmentError extends Error {
  constructor(
    readonly text: string,
    readonly alignment: unknown,
    readonly reason: string,
  ) {
    super("no alignment");
    this.name = "NoAlignmentError";
  }
}

const WS_RE = /\s/;

/**
 * Strips the markers and normalises whitespace exactly like `parseNarration`
 * in shared/validate.ts (so `text` equals its `spoken`), recording offsets.
 * A marker after whitespace points just past the collapsed space, so
 * `insertMarkers(text, cues)` rebuilds any narration whose text was already
 * normalised.
 */
export function stripMarkers(narration: string): StrippedNarration {
  let text = "";
  let pendingSpace = false;
  const cues: CueOffset[] = [];

  const addText = (chunk: string) => {
    for (const ch of chunk) {
      if (WS_RE.test(ch)) {
        if (text.length > 0) pendingSpace = true;
        continue;
      }
      if (pendingSpace) text += " ";
      pendingSpace = false;
      text += ch;
    }
  };

  let last = 0;
  for (const m of narration.matchAll(CUE_MARKER_RE)) {
    addText(narration.slice(last, m.index));
    cues.push({ cue: m[1], offset: text.length + (pendingSpace ? 1 : 0) });
    last = m.index + m[0].length;
  }
  addText(narration.slice(last));

  // A trailing pending space is never emitted (trim): clamp those offsets.
  for (const c of cues) c.offset = Math.min(c.offset, text.length);
  return { text, cues };
}

/** Puts `[[cue]]` markers back at their offsets (the inverse of stripMarkers). */
export function insertMarkers(text: string, cues: CueOffset[]): string {
  const sorted = cues
    .map((c, i) => ({ ...c, i }))
    .sort((a, b) => a.offset - b.offset || a.i - b.i);
  let out = "";
  let last = 0;
  for (const { cue, offset } of sorted) {
    out += text.slice(last, offset) + `[[${cue}]]`;
    last = offset;
  }
  return out + text.slice(last);
}

/** How far ahead (in alignment entries and in text units) a resync may look. */
const RESYNC_WINDOW = 64;

/**
 * Cue -> ms from the start of the audio. Each cue gets the start time of the
 * first non-space character at or after its offset that the walk matched; a
 * cue with no such character (the very end) gets the last character's end time.
 * Throws NoAlignmentError when `alignment` is null or malformed, or nothing
 * in it matches the text.
 */
export function cueTimes(
  text: string,
  cues: CueOffset[],
  alignment: Alignment | null | undefined,
): CueTimes {
  const starts = walkAlignment(text, alignment);
  const a = alignment as Alignment;
  const endMs = a.character_end_times_seconds.at(-1)! * 1000;

  const out: CueTimes = {};
  for (const { cue, offset } of cues) {
    if (cue in out) continue; // duplicates are rejected upstream; keep the first
    let ms = endMs;
    for (let p = offset; p < text.length; p++) {
      const t = starts[p];
      if (t !== undefined && !WS_RE.test(text[p])) {
        ms = t;
        break;
      }
    }
    out[cue] = ms;
  }
  return out;
}

/** Convenience: narration with markers + alignment of its stripped text -> cue times. */
export function narrationCueTimes(
  narration: string,
  alignment: Alignment | null | undefined,
): CueTimes {
  const { text, cues } = stripMarkers(narration);
  return cueTimes(text, cues, alignment);
}

/**
 * Walks the alignment against `text`. Returns, per UTF-16 index, the start
 * time (ms) of the alignment entry that matched there (only at the first unit
 * of each matched entry). An entry may be one code point, one UTF-16 unit or
 * a grapheme; it is matched as written or NFC/NFD-normalised. On a mismatch
 * the walk resyncs on the nearest pair (text position, entry) that matches,
 * skipping text the alignment dropped and entries it added.
 */
function walkAlignment(
  text: string,
  alignment: Alignment | null | undefined,
): (number | undefined)[] {
  const fail = (reason: string): never => {
    throw new NoAlignmentError(text, alignment, reason);
  };
  if (!alignment) return fail("alignment is null");
  const {
    characters: chars,
    character_start_times_seconds: startS,
    character_end_times_seconds: endS,
  } = alignment;
  if (
    !Array.isArray(chars) ||
    !Array.isArray(startS) ||
    !Array.isArray(endS) ||
    chars.length === 0 ||
    chars.length !== startS.length ||
    chars.length !== endS.length
  ) {
    return fail("alignment arrays are empty or of different lengths");
  }

  // Length in text units of the match of entry j at p, or 0.
  const matchAt = (p: number, j: number): number => {
    const s = chars[j];
    if (typeof s !== "string" || s.length === 0) return 0;
    for (const cand of new Set([s, s.normalize("NFC"), s.normalize("NFD")])) {
      if (text.startsWith(cand, p)) return cand.length;
    }
    return 0;
  };

  const starts: (number | undefined)[] = new Array(text.length);
  let matched = 0;
  let p = 0;
  let j = 0;
  while (p < text.length && j < chars.length) {
    let len = matchAt(p, j);
    if (len === 0) {
      // Resync: smallest total skip (dp + dj) first, fewer text skips on ties.
      let found = false;
      search: for (let d = 1; d <= 2 * RESYNC_WINDOW; d++) {
        for (let dp = 0; dp <= d; dp++) {
          const dj = d - dp;
          if (dp > RESYNC_WINDOW || dj > RESYNC_WINDOW) continue;
          if (p + dp >= text.length || j + dj >= chars.length) continue;
          const l = matchAt(p + dp, j + dj);
          if (l > 0) {
            p += dp;
            j += dj;
            len = l;
            found = true;
            break search;
          }
        }
      }
      if (!found) break;
    }
    starts[p] = startS[j] * 1000;
    matched++;
    p += len;
    j++;
  }

  if (matched === 0) fail("no alignment character matches the text");
  return starts;
}
