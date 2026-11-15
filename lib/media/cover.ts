// The lesson cover (ROADMAP L4, ARCHITECTURE.md section 5.1): one fal image per plan, from its
// coverPrompt, saved in the run folder and recorded as the plan's `cover`. It's page chrome,
// outside the scene contract. A cover is a nice-to-have, so nothing here fails the plan: with
// no FAL_KEY, a fal error, or past config.cover.timeoutMs, the plan comes back without one and
// the reason goes to the server log. fal credits are tight, so a saved cover is never made again.
import "server-only";
import type { LessonPlan } from "@/shared/lesson";
import { config } from "@/lib/config";
import { falImages, type ImageMaker, makeJpeg } from "@/lib/media/fal";
import { writeRunFile } from "@/lib/runs/store";

const TAG = "[cover]";

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
    const image = await makeJpeg(images, plan.coverPrompt, timeoutMs);
    await writeRunFile(lessonId, config.cover.file, image);
    return { ...plan, cover: config.cover.file };
  } catch (err) {
    console.warn(TAG, `lesson ${lessonId}: no cover:`, err);
    return plan;
  }
}
