// What "verbatim" means for a paper quote (issue #98, ARCHITECTURE.md section 4): one pure
// normaliser, used by the server to check that a step's PaperRef quote is on its page and by
// the browser to find it in the PDF's text layer, so a quote the server accepts is always found.
// Imported by the server and the browser: no node-only imports.
//
// A page's text is its text items joined in order, with any separator: PDF extractors differ
// in where they put spaces and line breaks, and the key drops whitespace anyway.
//
// The key of a text, code point by code point: NFKC (ligatures such as "ﬁ" become "fi", full
// width forms become ASCII), lower case, curly quotes folded to straight ones, and whitespace,
// soft hyphens, zero-width characters, hyphens and dashes dropped. Dropping hyphens joins a
// word broken across lines ("atten-\ntion") and keeps a compound broken at its own hyphen
// ("self-\nattention") equal to "self-attention".

/** A text's key, and where each key character came from in that text. */
export interface PaperKey {
  key: string;
  /** `at[i]`: the UTF-16 index, in the source text, of the code point key character i came from. */
  at: number[];
}

const DROPPED_RE = /[\s­​-‍⁠﻿\-‐-―−]/u;
const SINGLE_QUOTES_RE = /[‘’‚‛′]/gu;
const DOUBLE_QUOTES_RE = /[“-‟″]/gu;

export function paperKey(text: string): PaperKey {
  let key = "";
  const at: number[] = [];
  let index = 0;
  for (const ch of text) {
    const folded = ch
      .normalize("NFKC")
      .toLowerCase()
      .replace(SINGLE_QUOTES_RE, "'")
      .replace(DOUBLE_QUOTES_RE, '"');
    for (const out of folded) {
      if (DROPPED_RE.test(out)) continue;
      key += out;
      for (let k = 0; k < out.length; k++) at.push(index);
    }
    index += ch.length;
  }
  return { key, at };
}

/** A quote's place in a page's text: UTF-16 indices, `end` exclusive. */
export interface QuoteSpan {
  start: number;
  end: number;
}

/**
 * Where `quote` first appears in `pageText`, comparing keys, or null if it doesn't (or the quote
 * has nothing left once normalised). The span runs from the first to the last source character
 * that made the match, so it never starts or ends on dropped whitespace.
 */
export function findQuote(pageText: string, quote: string): QuoteSpan | null {
  const needle = paperKey(quote).key;
  if (needle.length === 0) return null;
  const page = paperKey(pageText);
  const i = page.key.indexOf(needle);
  if (i < 0) return null;
  const last = page.at[i + needle.length - 1];
  const lastCodePoint = pageText.codePointAt(last) ?? 0;
  return { start: page.at[i], end: last + (lastCodePoint > 0xffff ? 2 : 1) };
}
