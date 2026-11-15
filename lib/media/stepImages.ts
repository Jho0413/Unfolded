// Whiteboard illustrations (ROADMAP E1, ARCHITECTURE.md section 5.1): a step's image object
// becomes a fal image, made while the step is narrated, saved in the run folder and named in
// the object's mediaUrl. Like the cover, an image is a nice-to-have, so nothing here fails the
// step: with no FAL_KEY, a fal error, bytes that aren't a JPEG, or past
// config.stepImages.timeoutMs, the object keeps no mediaUrl (the board doesn't draw it) and the
// reason goes to the server log. fal credits are tight, so a lesson makes at most
// config.maxImagesPerLesson images, its cover included, counted from its run files, and a step
// at most config.stepImages.maxPerStep. Replay never gets here: it never generates a step.
import "server-only";
import type { ImageObject, SceneObject, Step } from "@/shared/scene";
import { config } from "@/lib/config";
import { falImages, type ImageMaker, makeJpeg } from "@/lib/media/fal";
import {
  lessonImageCount,
  listRunFiles,
  nextStepVersion,
  stepImageFileName,
  writeRunFile,
} from "@/lib/runs/store";

const TAG = "[step-images]";

/**
 * Images being made right now, per lesson. They count against the cap before their files are
 * saved, so two steps generating at once (one prefetched) can't both take the last one.
 */
const making = new Map<string, number>();

/**
 * The image objects of a step that get an image: the first `perStep` of them, while the
 * lesson, having made `used` images, stays within `cap`. Pure.
 */
export function imagesToMake(
  objects: readonly SceneObject[],
  used: number,
  cap: number = config.maxImagesPerLesson,
  perStep: number = config.stepImages.maxPerStep,
): ImageObject[] {
  const room = Math.max(0, Math.min(perStep, cap - used));
  return objects
    .filter((o): o is ImageObject => o.kind === "image")
    .slice(0, room);
}

/**
 * Step n with an image made for each of its image objects that imagesToMake allows, saved as
 * img-<n>-v<k>-<id>.jpg and named in that object's mediaUrl. k is the version this generation
 * is about to save: one generation per step runs at a time (lessonStep.ts), and only
 * saveStepVersion writes step files, so it claims the same version. Never throws: an object
 * without an image is left as it is, and the reason logged.
 */
export async function illustrateStep(
  lessonId: string,
  n: number,
  step: Step,
  images: ImageMaker | undefined = falImages(),
  timeoutMs: number = config.stepImages.timeoutMs,
): Promise<Step> {
  const where = `${TAG} ${lessonId} step ${n}`;
  const wanted = step.objects.filter((o) => o.kind === "image");
  if (wanted.length === 0) return step;
  if (images === undefined) {
    console.info(`${where}: images not drawn (no FAL_KEY)`);
    return step;
  }
  let reserved = 0;
  try {
    const files = await listRunFiles(lessonId);
    const version = nextStepVersion(files, n);
    const chosen = imagesToMake(
      step.objects,
      lessonImageCount(files) + (making.get(lessonId) ?? 0),
    );
    reserved = chosen.length;
    making.set(lessonId, (making.get(lessonId) ?? 0) + reserved);
    for (const skipped of wanted.slice(chosen.length))
      console.info(
        `${where}: image "${skipped.id}" not drawn (the lesson's cap of ${config.maxImagesPerLesson} images, or ${config.stepImages.maxPerStep} per step)`,
      );

    const urls = new Map<string, string>();
    await Promise.all(
      chosen.map(async (obj) => {
        try {
          const image = await makeJpeg(images, obj.prompt, timeoutMs);
          const file = stepImageFileName(n, version, obj.id);
          await writeRunFile(lessonId, file, image);
          urls.set(obj.id, `/api/runs/${lessonId}/${file}`);
        } catch (err) {
          console.warn(`${where}: image "${obj.id}" not drawn:`, err);
        }
      }),
    );
    return {
      ...step,
      objects: step.objects.map((o) => {
        const mediaUrl = o.kind === "image" ? urls.get(o.id) : undefined;
        return mediaUrl === undefined ? o : { ...o, mediaUrl };
      }),
    };
  } catch (err) {
    console.warn(`${where}: images not drawn:`, err);
    return step;
  } finally {
    const left = (making.get(lessonId) ?? 0) - reserved;
    if (left > 0) making.set(lessonId, left);
    else making.delete(lessonId);
  }
}
