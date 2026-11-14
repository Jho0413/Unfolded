// The lesson page (ROADMAP P6, ARCHITECTURE.md sections 3 and 5): plays a saved lesson from
// runs/<lessonId>/ in the player. The plan and the list of saved step versions are read here,
// on the server; the steps and their audio reach the browser through GET /api/runs.
//
// A bad lessonId or a lesson with no saved plan is a 404 with "No such lesson or step."
// (./not-found.tsx). A step with no saved file fails in the player with "This step isn't in
// the saved run.", and Back or Retry recover.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getEnv } from "@/lib/env";
import { INK, PAGE_BG } from "@/player/primitives/style";
import { LessonView } from "./LessonView";
import { loadLesson } from "./loadLesson";

export const metadata: Metadata = { title: "Lesson" };

export default async function LessonPage({
  params,
  searchParams,
}: PageProps<"/lesson/[lessonId]">) {
  // A run folder changes after the build, so it's read on every request.
  await connection();
  const { lessonId } = await params;
  const lesson = await loadLesson(lessonId);
  if (lesson.kind === "missing") notFound();
  const { debug } = await searchParams;
  return (
    <main style={PAGE}>
      <LessonView
        lessonId={lesson.lessonId}
        plan={lesson.plan}
        versions={lesson.versions}
        replay={getEnv().mode === "replay"}
        debug={debug === "1"}
      />
    </main>
  );
}

const PAGE = {
  fontFamily: "system-ui, sans-serif",
  background: PAGE_BG,
  color: INK,
  minHeight: "100vh",
  padding: 24,
  boxSizing: "border-box",
} as const;
