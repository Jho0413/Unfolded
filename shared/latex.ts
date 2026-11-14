// KaTeX settings for model-written `tex` (ARCHITECTURE.md section 4). One set
// for the validator (which adds throwOnError: true) and the renderer (which
// keeps throwOnError: false as a safety net), so both accept the same input.
// The tex is untrusted, so these follow https://katex.org/docs/security.
import type { KatexOptions } from "katex";

export const KATEX_OPTIONS = {
  /** No \href, \url, \includegraphics, \htmlClass and the like. */
  trust: false,
  /** Accept KaTeX's convenient non-LaTeX features without console warnings. */
  strict: "ignore",
  /** Caps sizes such as \rule{500em}{500em}, in ems. */
  maxSize: 10,
  /** Stops macro loops such as \def\a{\a}\a. */
  maxExpand: 1000,
} as const satisfies KatexOptions;
