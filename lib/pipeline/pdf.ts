// Cheap checks on an uploaded PDF's bytes before it goes to the Files API (ARCHITECTURE.md
// sections 5.1 and 7). Pure. We don't parse the PDF: these catch the common cases early and
// without a paid request, and anything they miss (a page count hidden in compressed object
// streams, a PDF Claude can't read) is rejected by Claude, which the route reports the same way.
import "server-only";

/** Why an upload can't be used. `not-pdf`: "Please choose a PDF."; the rest: too large or locked. */
export type PdfProblem =
  "not-pdf" | "too-large" | "encrypted" | "too-many-pages";

export interface PdfLimits {
  maxBytes: number;
  maxPages: number;
}

/** A PDF's header may follow some junk, but must start within the first 1024 bytes. */
const HEADER_WINDOW = 1024;
const HEADER = "%PDF-";
/** The trailer's /Encrypt entry, present in every encrypted PDF. */
const ENCRYPT_RE = /\/Encrypt(?![A-Za-z])/;
/** One page object: /Type /Page, but not /Type /Pages (the page tree). */
const PAGE_RE = /\/Type\s*\/Page(?![A-Za-z])/g;

/** The first problem with these bytes, or undefined when they pass every check. */
export function pdfProblem(
  bytes: Uint8Array,
  limits: PdfLimits,
): PdfProblem | undefined {
  // latin1 maps every byte to one character, so offsets and binary data survive.
  const head = Buffer.from(
    bytes.subarray(0, HEADER_WINDOW - 1 + HEADER.length),
  ).toString("latin1");
  if (!head.includes(HEADER)) return "not-pdf";
  if (bytes.length > limits.maxBytes) return "too-large";
  const text = Buffer.from(bytes).toString("latin1");
  if (ENCRYPT_RE.test(text)) return "encrypted";
  const pages = text.match(PAGE_RE)?.length ?? 0;
  if (pages > limits.maxPages) return "too-many-pages";
  return undefined;
}
