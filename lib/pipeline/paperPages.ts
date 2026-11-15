// The paper's page text, for checking the step generator's quotes (issue #98, ARCHITECTURE.md
// section 5.1). Extracted from runs/<id>/paper.pdf with pdf.js, the library the paper viewer
// highlights with (player/paper/usePaperDoc.ts), each page's text items joined in order as the
// viewer joins them, so a quote shared/paperText.ts findQuote finds here is found there too.
// Extracted once per paper and kept in paper-text.json.
import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  PAPER_PDF_FILE,
  PAPER_TEXT_FILE,
  readRunFile,
  readRunJson,
  writeRunJson,
} from "@/lib/runs/store";

const TAG = "[pipeline]";

/** paper-text.json: the pages' text, and which paper.pdf it came from. */
export const PaperText = z.object({
  /** sha256 of paper.pdf, hex: a different paper means extracting again. */
  pdfSha256: z.string(),
  /** Page n's text at n - 1. */
  pages: z.array(z.string()),
});
export type PaperText = z.infer<typeof PaperText>;

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjs: Promise<Pdfjs> | undefined;

/**
 * pdf.js's Node build. Node has no Worker, so pdf.js runs its worker on this thread, and finds
 * it on globalThis.pdfjsWorker: imported here, so the server bundle has it, rather than through
 * pdf.js's own import of the worker's file path, which a bundled server can't resolve.
 */
function loadPdfjs(): Promise<Pdfjs> {
  pdfjs ??= (async () => {
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return import("pdfjs-dist/legacy/build/pdf.mjs");
  })();
  return pdfjs;
}

/** Each page's text, page 1 first: its text items joined in order. Throws when pdf.js can't. */
export async function extractPageTexts(pdf: Uint8Array): Promise<string[]> {
  const { getDocument, VerbosityLevel } = await loadPdfjs();
  // pdf.js takes the buffer over, so it gets a copy. Errors only: it warns about missing
  // font data, which it doesn't need for text.
  const task = getDocument({
    data: new Uint8Array(pdf),
    verbosity: VerbosityLevel.ERRORS,
  });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(
        content.items.map((item) => ("str" in item ? item.str : "")).join(""),
      );
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/**
 * The lesson's paper as page text, or undefined when there is none to check quotes against: a
 * run made before #98 has no paper.pdf (normal), a PDF pdf.js can't read is logged, and a
 * scanned paper has no text at all. Read from paper-text.json when it is this paper.pdf's,
 * otherwise extracted and saved there.
 */
export async function readPaperPages(
  lessonId: string,
): Promise<string[] | undefined> {
  const pdf = await readRunFile(lessonId, PAPER_PDF_FILE);
  if (pdf.kind === "missing") return undefined;
  if (pdf.kind === "refused") {
    console.error(
      `${TAG} ${lessonId}: can't read ${PAPER_PDF_FILE} (${pdf.reason}), so no paper quotes`,
    );
    return undefined;
  }
  const pdfSha256 = createHash("sha256").update(pdf.data).digest("hex");
  const cached = await readRunJson(lessonId, PAPER_TEXT_FILE, PaperText).catch(
    (err: unknown) => {
      console.warn(
        `${TAG} ${lessonId}: ${PAPER_TEXT_FILE} unreadable, extracting again`,
        err,
      );
      return undefined;
    },
  );
  if (cached?.pdfSha256 === pdfSha256) return withText(cached.pages);
  let pages: string[];
  try {
    pages = await extractPageTexts(pdf.data);
  } catch (err) {
    console.error(
      `${TAG} ${lessonId}: couldn't extract the text of ${PAPER_PDF_FILE}, so no paper quotes`,
      err,
    );
    return undefined;
  }
  await writeRunJson(lessonId, PAPER_TEXT_FILE, {
    pdfSha256,
    pages,
  } satisfies PaperText);
  return withText(pages);
}

/** No quote can be found in a paper with no text (a scan), so none is asked for. */
function withText(pages: string[]): string[] | undefined {
  return pages.some((text) => text.trim() !== "") ? pages : undefined;
}
