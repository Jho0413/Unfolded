// The upload page's sample lessons (ARCHITECTURE.md section 5.1): the ready-made runs in
// config.samples that this server has, each labelled with its plan's title.
import "server-only";
import { loadLesson } from "@/app/lesson/[lessonId]/loadLesson";
import { config } from "@/lib/config";

export interface SampleLesson {
  lessonId: string;
  title: string;
}

/** The samples whose plan.json is here and readable, in config order. */
export async function sampleLessons(
  ids: readonly string[] = config.samples,
): Promise<SampleLesson[]> {
  const lessons = await Promise.all(ids.map((id) => loadLesson(id)));
  return lessons.flatMap((l) =>
    l.kind === "ok" ? [{ lessonId: l.lessonId, title: l.plan.title }] : [],
  );
}
