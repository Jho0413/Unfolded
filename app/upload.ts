// What the upload page and POST /api/lessons share (ARCHITECTURE.md section 7): the form field
// and the words the learner sees when an upload or a plan fails. No server-only imports.

/** The multipart form field that carries the PDF. */
export const PDF_FIELD = "pdf";

export const UPLOAD_ERRORS = {
  /** No file, or not a PDF. */
  notPdf: "Please choose a PDF.",
  /** Over config.maxPdfMb, or the PDF can't be used (too many pages, encrypted, unreadable). */
  tooLargeOrLocked: "This PDF is too large or locked.",
  /** Invalid plan twice, refusal, or a Claude error. */
  planFailed: "Couldn't read this PDF.",
} as const;
