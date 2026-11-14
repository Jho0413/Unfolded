// The lesson cover (ROADMAP L4, ARCHITECTURE.md section 5.1): one fal image per plan, from its
// coverPrompt, saved in the run folder and recorded as the plan's `cover`. It's page chrome,
// outside the scene contract. A cover is a nice-to-have, so nothing here fails the plan: with
// no FAL_KEY, a fal error, or past config.cover.timeoutMs, the plan comes back without one and
// the reason goes to the server log. fal credits are tight, so a saved cover is never made again.
import "server-only";
import type { LessonPlan } from "@/shared/lesson";
import { config } from "@/lib/config";
import { falImages, type ImageMaker } from "@/lib/media/fal";
import { writeRunFile } from "@/lib/runs/store";

const TAG = "[cover]";

export class CoverTimeoutError extends Error {
  override name = "CoverTimeoutError";
}

/**
 * Runs `work` with a deadline of its own: past `ms` it rejects with CoverTimeoutError and
 * aborts the signal, even if `work` ignores it, so a hung provider can't hold the plan.
 */
export async function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new CoverTimeoutError(`no cover after ${ms} ms`);
      controller.abort(err);
      reject(err);
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The plan with its cover: made with `images`, saved as config.cover.file in the lesson's run
 * folder, and named in `cover`. A plan that already has a cover is returned as it is. Never
 * throws: without a cover the plan is returned unchanged.
 */
export async function addCover(
  lessonId: string,
  plan: LessonPlan,
  images: ImageMaker | undefined = falImages(),
  timeoutMs: number = config.cover.timeoutMs,
): Promise<LessonPlan> {
  if (plan.cover !== undefined) return plan;
  if (images === undefined) {
    console.info(TAG, `lesson ${lessonId}: no cover (no FAL_KEY)`);
    return plan;
  }
  try {
    const image = await withDeadline(
      (signal) => images.make(plan.coverPrompt, signal),
      timeoutMs,
    );
    // The file is named .jpg and served as image/jpeg: anything else would be served wrongly.
    if (!image.contentType.startsWith("image/jpeg") || image.bytes.length === 0)
      throw new Error(
        `fal sent ${image.bytes.length} bytes of "${image.contentType}", not a JPEG`,
      );
    await writeRunFile(lessonId, config.cover.file, image.bytes);
    return { ...plan, cover: config.cover.file };
  } catch (err) {
    console.warn(TAG, `lesson ${lessonId}: no cover:`, err);
    return plan;
  }
}
