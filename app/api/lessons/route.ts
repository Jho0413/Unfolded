// POST /api/lessons: a PDF in, a lesson plan out (ARCHITECTURE.md sections 5.1 and 7). The
// body is multipart form data with the PDF in PDF_FIELD; the answer is { lessonId, plan }, with
// plan.json saved to the run folder. Any failure gives the learner plain words from
// UPLOAD_ERRORS and the developer the reason in the server log.
import "server-only";
import { config } from "@/lib/config";
import { GenerationError } from "@/lib/pipeline/generate";
import { pdfProblem } from "@/lib/pipeline/pdf";
import { createLesson, paperRejected } from "@/lib/pipeline/plan";
import type { ApiError, CreateLessonResponse } from "@/shared/lesson";
import { PDF_FIELD, UPLOAD_ERRORS } from "@/app/upload";

const TAG = "[api/lessons]";
const MB = 1024 * 1024;
const MAX_PDF_BYTES = config.maxPdfMb * MB;
/** Room for the multipart boundaries and headers around the PDF in the request body. */
const FORM_OVERHEAD_BYTES = 64 * 1024;
/** The Files API name when the browser sends none. */
const DEFAULT_FILENAME = "paper.pdf";

function failed(error: string, status: number): Response {
  return Response.json({ error } satisfies ApiError, { status });
}

export async function POST(request: Request): Promise<Response> {
  // Refuse a body that's too big before reading it into memory. A body sent with no length
  // (chunked) is read, then checked by size below.
  const length = Number(request.headers.get("content-length"));
  if (length > MAX_PDF_BYTES + FORM_OVERHEAD_BYTES) {
    console.warn(TAG, `rejected upload (too-large): a ${length}-byte body`);
    return failed(UPLOAD_ERRORS.tooLargeOrLocked, 413);
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get(PDF_FIELD);
  } catch {
    console.warn(TAG, "bad request: the body is not form data");
    return failed(UPLOAD_ERRORS.notPdf, 400);
  }
  if (!(file instanceof File)) {
    console.warn(TAG, `bad request: no file in "${PDF_FIELD}"`);
    return failed(UPLOAD_ERRORS.notPdf, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = pdfProblem(bytes, {
    maxBytes: MAX_PDF_BYTES,
    maxPages: config.maxPdfPages,
  });
  if (problem !== undefined) {
    console.warn(TAG, `rejected upload (${problem}): ${bytes.length} bytes`);
    return problem === "not-pdf"
      ? failed(UPLOAD_ERRORS.notPdf, 400)
      : failed(
          UPLOAD_ERRORS.tooLargeOrLocked,
          problem === "too-large" ? 413 : 422,
        );
  }

  try {
    const created = await createLesson({
      bytes,
      filename: file.name || DEFAULT_FILENAME,
    });
    return Response.json(created satisfies CreateLessonResponse);
  } catch (err) {
    console.error(TAG, err instanceof GenerationError ? err.message : err);
    if (paperRejected(err)) return failed(UPLOAD_ERRORS.tooLargeOrLocked, 422);
    // A GenerationError is Claude failing (502); anything else is a bug, a failed save or a
    // misconfiguration.
    return failed(
      UPLOAD_ERRORS.planFailed,
      err instanceof GenerationError ? 502 : 500,
    );
  }
}
