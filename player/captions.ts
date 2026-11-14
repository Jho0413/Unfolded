// Captions (ARCHITECTURE.md section 5.6): the narration sentence being spoken at time t, and
// an estimate of how much of it has been said. Pure. The browser only has the cue times (no
// per-word times), so the spoken character offset is interpolated linearly between known
// (offset, time) anchors: the start (0 s), each cue, and the end of the audio.
//
// `prepareNarration` does the per-step work (markers stripped, sentences split) once;
// `captionFrom` is the per-frame lookup. `captionAt` is both, for one-off calls and tests.
import { stripMarkers } from "@/lib/narration/cues";
import type { CueTimes } from "@/shared/lesson";

export type Caption = {
  /** The sentence's index among the narration's sentences. */
  index: number;
  /** The sentence, as in the narration with its markers stripped. */
  text: string;
  /** `text.slice(0, spoken)` has been said: whole words only. */
  spoken: number;
  /** `text.slice(spoken, current)` is the word being said (empty between words). */
  current: number;
};

type Anchor = { offset: number; ms: number };

/** The narration's sentences, with their start offsets in the stripped text. */
export type Sentences = { text: string; start: number }[];

/** Splits stripped narration into sentences (Intl.Segmenter, so any script works). */
export function sentencesOf(text: string): Sentences {
  const out: Sentences = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
  for (const { segment, index } of segmenter.segment(text)) {
    const lead = segment.length - segment.trimStart().length;
    const trimmed = segment.trim();
    if (trimmed !== "") out.push({ text: trimmed, start: index + lead });
  }
  return out;
}

/**
 * The anchors, in text order, with times that never go back and never pass the end, so the
 * offset only moves forward as t grows.
 */
function anchorsOf(
  textLength: number,
  cues: { cue: string; offset: number }[],
  cueTimes: CueTimes,
  durationMs: number | null,
): Anchor[] {
  const endKnown =
    durationMs !== null && Number.isFinite(durationMs) && durationMs > 0;
  const cap = endKnown ? durationMs : Infinity;
  const anchors: Anchor[] = [{ offset: 0, ms: 0 }];
  for (const { cue, offset } of cues) {
    if (!Object.hasOwn(cueTimes, cue)) continue;
    const prev = anchors[anchors.length - 1];
    const ms = Math.min(cap, Math.max(prev.ms, cueTimes[cue]));
    anchors.push({ offset: Math.max(prev.offset, offset), ms });
  }
  if (endKnown) {
    const prev = anchors[anchors.length - 1];
    anchors.push({ offset: textLength, ms: Math.max(prev.ms, durationMs) });
  }
  return anchors;
}

/** The character offset being spoken at `tMs`. */
function offsetAt(anchors: Anchor[], tMs: number): number {
  let offset = 0;
  // anchors[0] is (0, 0 ms), so a time before it is the start.
  if (!(tMs > 0)) return 0;
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i];
    if (tMs < a.ms) {
      const prev = anchors[i - 1];
      const span = a.ms - prev.ms;
      return prev.offset + ((tMs - prev.ms) / span) * (a.offset - prev.offset);
    }
    offset = a.offset;
  }
  return offset;
}

const WS = /\s/;

/**
 * The caption at `tMs` for a step's narration (with its [[cue]] markers), its cue times and
 * its audio's duration (null or NaN while unknown: the offset then stops at the last cue).
 * Null when the narration has no words.
 */
export function captionAt(
  narration: string,
  cueTimes: CueTimes,
  durationMs: number | null,
  tMs: number,
): Caption | null {
  return captionFrom(prepareNarration(narration), cueTimes, durationMs, tMs);
}

/** A step's narration, ready for captions: stripped, with its cues and sentences. */
export type PreparedNarration = {
  text: string;
  cues: { cue: string; offset: number }[];
  sentences: Sentences;
};

export function prepareNarration(narration: string): PreparedNarration {
  const { text, cues } = stripMarkers(narration);
  return { text, cues, sentences: sentencesOf(text) };
}

/** `captionAt` on a prepared narration. */
export function captionFrom(
  { text, cues, sentences }: PreparedNarration,
  cueTimes: CueTimes,
  durationMs: number | null,
  tMs: number,
): Caption | null {
  if (sentences.length === 0) return null;
  const at = Math.min(
    text.length,
    Math.floor(
      offsetAt(anchorsOf(text.length, cues, cueTimes, durationMs), tMs),
    ),
  );
  // The last sentence that starts at or before the offset.
  let index = 0;
  for (let i = 0; i < sentences.length; i++)
    if (sentences[i].start <= at) index = i;
  const sentence = sentences[index];
  const p = Math.max(0, Math.min(sentence.text.length, at - sentence.start));
  if (at >= text.length || p >= sentence.text.length)
    return {
      index,
      text: sentence.text,
      spoken: sentence.text.length,
      current: sentence.text.length,
    };
  // Between words: everything before p has been said.
  if (WS.test(sentence.text[p]))
    return { index, text: sentence.text, spoken: p, current: p };
  // Inside a word: snap to whole words; that word is the one being said.
  let spoken = p;
  while (spoken > 0 && !WS.test(sentence.text[spoken - 1])) spoken--;
  let current = p;
  while (current < sentence.text.length && !WS.test(sentence.text[current]))
    current++;
  return { index, text: sentence.text, spoken, current };
}
